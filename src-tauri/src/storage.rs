use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDocument {
    pub id: String,
    pub name: String,
    pub template: String,
    pub values: BTreeMap<String, String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct PromptFolder {
    pub name: String,
    pub prompts: Vec<PromptDocument>,
}

#[derive(Debug, Default, Serialize)]
pub struct Library {
    pub folders: Vec<PromptFolder>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Settings {
    pub directory: String,
}

fn io_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("{action}: {error}")
}

pub fn validate_folder_name(name: &str) -> Result<(), String> {
    let reserved = name.split('.').next().unwrap_or("").to_uppercase();
    if name.is_empty()
        || name.trim() != name
        || name.chars().count() > 100
        || name.ends_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || ["CON", "PRN", "AUX", "NUL"].contains(&reserved.as_str())
        || ((reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.len() == 4
            && matches!(reserved.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(
            "Use a valid folder name without path separators or reserved characters.".into(),
        );
    }
    Ok(())
}

fn validate_prompt(prompt: &PromptDocument) -> Result<(), String> {
    if prompt.id.is_empty()
        || prompt.id.len() > 100
        || !prompt
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid prompt identifier.".into());
    }
    if prompt.name.trim().is_empty() || prompt.name.chars().count() > 150 {
        return Err("Prompt names must contain 1 to 150 characters.".into());
    }
    Ok(())
}

pub fn read_settings(config: &Path, default_directory: &Path) -> Result<Settings, String> {
    let path = config.join("settings.json");
    match fs::read_to_string(path) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|e| io_error("Cannot read settings", e))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings {
            directory: default_directory.to_string_lossy().into_owned(),
        }),
        Err(error) => Err(io_error("Cannot read settings", error)),
    }
}

pub fn write_settings(config: &Path, directory: &str) -> Result<Settings, String> {
    let path = Path::new(directory);
    if !path.is_absolute() {
        return Err("Choose an absolute directory path.".into());
    }
    fs::create_dir_all(path).map_err(|e| io_error("Cannot create save directory", e))?;
    let canonical =
        fs::canonicalize(path).map_err(|e| io_error("Cannot open save directory", e))?;
    // Check that the new library can be read before committing the preference.
    load_library(&canonical)?;
    let settings = Settings {
        directory: directory.into(),
    };
    fs::create_dir_all(config).map_err(|e| io_error("Cannot create settings directory", e))?;
    let data = serde_json::to_vec_pretty(&settings)
        .map_err(|e| io_error("Cannot serialize settings", e))?;
    atomic_write(&config.join("settings.json"), &data)?;
    Ok(settings)
}

fn library_root(root: &Path) -> Result<PathBuf, String> {
    if !root.is_absolute() {
        return Err("The library directory must be an absolute path.".into());
    }
    fs::create_dir_all(root).map_err(|e| io_error("Cannot create library directory", e))?;
    fs::canonicalize(root).map_err(|e| io_error("Cannot open library directory", e))
}

fn folder_path(root: &Path, name: &str, create: bool) -> Result<PathBuf, String> {
    validate_folder_name(name)?;
    let folder = root.join(name);
    if let Ok(metadata) = fs::symlink_metadata(&folder) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Prompt folders must be regular directories inside the library.".into());
        }
    } else if create {
        fs::create_dir(&folder).map_err(|e| io_error("Cannot create prompt folder", e))?;
    }
    let canonical =
        fs::canonicalize(&folder).map_err(|e| io_error("Cannot open prompt folder", e))?;
    if canonical.parent() != Some(root) {
        return Err("The prompt folder is outside the library directory.".into());
    }
    Ok(canonical)
}

pub fn create_folder(root: &Path, name: &str) -> Result<(), String> {
    validate_folder_name(name)?;
    let root = library_root(root)?;
    let path = root.join(name);
    // create_dir returns AlreadyExists rather than silently using a duplicate.
    fs::create_dir(&path).map_err(|e| io_error("Cannot create folder", e))?;
    folder_path(&root, name, false)?;
    Ok(())
}

pub fn save_prompt(root: &Path, folder: &str, prompt: &PromptDocument) -> Result<(), String> {
    validate_folder_name(folder)?;
    validate_prompt(prompt)?;
    let root = library_root(root)?;
    let folder = folder_path(&root, folder, true)?;
    let bytes =
        serde_json::to_vec_pretty(prompt).map_err(|e| io_error("Cannot serialize prompt", e))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err("Prompt files must be smaller than 5 MB.".into());
    }
    atomic_write(&folder.join(format!("{}.prompt.json", prompt.id)), &bytes)
}

pub fn load_library(root: &Path) -> Result<Library, String> {
    let mut library = Library::default();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(library),
        Err(error) => return Err(io_error("Cannot read library directory", error)),
    };
    let root = fs::canonicalize(root).map_err(|e| io_error("Cannot open library directory", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| io_error("Cannot read library entry", e))?;
        let metadata = entry
            .file_type()
            .map_err(|e| io_error("Cannot inspect library entry", e))?;
        if !metadata.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = match folder_path(&root, &name, false) {
            Ok(path) => path,
            Err(error) => {
                library
                    .warnings
                    .push(format!("Skipped folder '{name}': {error}"));
                continue;
            }
        };
        let mut folder = PromptFolder {
            name,
            prompts: Vec::new(),
        };
        for file in fs::read_dir(&path).map_err(|e| io_error("Cannot read prompt folder", e))? {
            let file = file.map_err(|e| io_error("Cannot read prompt entry", e))?;
            let filename = file.file_name().to_string_lossy().into_owned();
            if !filename.ends_with(".prompt.json") {
                continue;
            }
            let read_prompt = || -> Result<PromptDocument, String> {
                let metadata = fs::symlink_metadata(file.path()).map_err(|e| e.to_string())?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("not a regular prompt file".into());
                }
                if metadata.len() > 5 * 1024 * 1024 {
                    return Err("file exceeds 5 MB".into());
                }
                let content = fs::read(file.path()).map_err(|e| e.to_string())?;
                let prompt: PromptDocument =
                    serde_json::from_slice(&content).map_err(|e| e.to_string())?;
                validate_prompt(&prompt)?;
                if filename != format!("{}.prompt.json", prompt.id) {
                    return Err("identifier does not match the filename".into());
                }
                Ok(prompt)
            };
            match read_prompt() {
                Ok(prompt) => folder.prompts.push(prompt),
                Err(error) => library.warnings.push(format!(
                    "Could not load {}/{filename}: {error}. The file was left untouched.",
                    folder.name
                )),
            }
        }
        folder
            .prompts
            .sort_by_key(|prompt| prompt.name.to_lowercase());
        library.folders.push(folder);
    }
    library
        .folders
        .sort_by_key(|folder| folder.name.to_lowercase());
    Ok(library)
}

// Write beside the destination and rename only after the entire file is synced.
// A failed write leaves the previous version intact.
fn atomic_write(destination: &Path, contents: &[u8]) -> Result<(), String> {
    if fs::symlink_metadata(destination).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("Cannot replace a symbolic link with a prompt or settings file.".into());
    }
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temp = destination.with_file_name(format!(
        ".prompt-builder-{}-{timestamp}-{}.tmp",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| io_error("Cannot save file", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "prompt-builder-test-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn prompt() -> PromptDocument {
        PromptDocument {
            id: "test-123".into(),
            name: "Test prompt".into(),
            template: "Hello ${'Name':Text}".into(),
            values: BTreeMap::from([("Name".into(), "Ada".into())]),
            updated_at: "2026-10-11T00:00:00Z".into(),
        }
    }

    #[test]
    fn round_trip_and_replace_preserve_template_and_values() {
        let root = TestDirectory::new();
        let mut document = prompt();
        save_prompt(&root.0, "Songs", &document).unwrap();
        document.values.insert("Name".into(), "Grace".into());
        save_prompt(&root.0, "Songs", &document).unwrap();
        let loaded = load_library(&root.0).unwrap();
        assert_eq!(loaded.folders[0].prompts.len(), 1);
        assert_eq!(loaded.folders[0].prompts[0].values["Name"], "Grace");
        assert_eq!(loaded.folders[0].prompts[0].template, document.template);
        assert!(loaded.warnings.is_empty());
    }

    #[test]
    fn malformed_files_are_reported_without_losing_valid_prompts() {
        let root = TestDirectory::new();
        save_prompt(&root.0, "Songs", &prompt()).unwrap();
        let bad_file = root.0.join("Songs/bad.prompt.json");
        fs::write(&bad_file, "broken json").unwrap();
        let loaded = load_library(&root.0).unwrap();
        assert_eq!(loaded.folders[0].prompts.len(), 1);
        assert_eq!(loaded.warnings.len(), 1);
        assert_eq!(fs::read_to_string(bad_file).unwrap(), "broken json");
    }

    #[test]
    fn paths_and_reserved_names_are_rejected() {
        let root = TestDirectory::new();
        for name in [
            "../outside",
            "..",
            "",
            "CON",
            "aux.txt",
            "LPT1",
            "C:\\temp",
            "trailing.",
        ] {
            assert!(create_folder(&root.0, name).is_err(), "Accepted {name}");
        }
        let mut document = prompt();
        document.id = "../escape".into();
        assert!(save_prompt(&root.0, "Songs", &document).is_err());
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0);
    }

    #[test]
    fn empty_folders_and_settings_survive_reload() {
        let root = TestDirectory::new();
        let config = root.0.join("config");
        let library = root.0.join("library");
        assert_eq!(
            read_settings(&config, &library).unwrap().directory,
            library.to_string_lossy()
        );
        write_settings(&config, library.to_str().unwrap()).unwrap();
        create_folder(&library, "Empty").unwrap();
        assert!(create_folder(&library, "Empty").is_err());
        assert!(
            load_library(&library).unwrap().folders[0]
                .prompts
                .is_empty()
        );
        assert_eq!(
            read_settings(&config, &root.0).unwrap().directory,
            library.to_string_lossy()
        );
    }
}
