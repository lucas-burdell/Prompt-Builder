mod storage;

use std::path::PathBuf;
use storage::{Library, PromptDocument, Settings};
use tauri::Manager;

fn settings_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let default = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("Prompt Builder");
    Ok((config, default))
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let (config, default) = settings_paths(&app)?;
    storage::read_settings(&config, &default)
}

#[tauri::command]
fn set_storage_directory(app: tauri::AppHandle, directory: String) -> Result<Settings, String> {
    let (config, _) = settings_paths(&app)?;
    storage::write_settings(&config, &directory)
}

#[tauri::command]
fn load_library(app: tauri::AppHandle) -> Result<Library, String> {
    storage::load_library(&PathBuf::from(get_settings(app)?.directory))
}

#[tauri::command]
fn create_folder(app: tauri::AppHandle, name: String) -> Result<(), String> {
    storage::create_folder(&PathBuf::from(get_settings(app)?.directory), &name)
}

#[tauri::command]
fn save_prompt(
    app: tauri::AppHandle,
    folder: String,
    prompt: PromptDocument,
) -> Result<(), String> {
    storage::save_prompt(
        &PathBuf::from(get_settings(app)?.directory),
        &folder,
        &prompt,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_storage_directory,
            load_library,
            create_folder,
            save_prompt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
