import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PromptDocument {
  id: string;
  name: string;
  template: string;
  values: Record<string, string>;
  updatedAt: string;
}
export interface PromptFolder {
  name: string;
  prompts: PromptDocument[];
}
export interface Library {
  folders: PromptFolder[];
  warnings: string[];
}
export interface Settings {
  directory: string;
}

export const desktop = isTauri();
const previewKey = "prompt-builder.preview.library.v1";

function previewLibrary(): Library {
  const saved = localStorage.getItem(previewKey);
  return saved ? (JSON.parse(saved) as Library) : { folders: [], warnings: [] };
}

export const storage = {
  getSettings: (): Promise<Settings> =>
    desktop
      ? invoke("get_settings")
      : Promise.resolve({ directory: "Browser storage (preview)" }),
  load: async (): Promise<Library> =>
    desktop ? invoke("load_library") : previewLibrary(),
  setDirectory: (directory: string): Promise<Settings> =>
    invoke("set_storage_directory", { directory }),
  async createFolder(name: string): Promise<void> {
    if (desktop) return invoke("create_folder", { name });
    const library = previewLibrary();
    if (
      library.folders.some(
        (folder) => folder.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("A folder with this name already exists.");
    library.folders.push({ name, prompts: [] });
    localStorage.setItem(previewKey, JSON.stringify(library));
  },
  async save(folder: string, prompt: PromptDocument): Promise<void> {
    if (desktop) return invoke("save_prompt", { folder, prompt });
    const library = previewLibrary();
    let target = library.folders.find((item) => item.name === folder);
    if (!target) {
      target = { name: folder, prompts: [] };
      library.folders.push(target);
    }
    target.prompts = [
      ...target.prompts.filter((item) => item.id !== prompt.id),
      prompt,
    ];
    localStorage.setItem(previewKey, JSON.stringify(library));
  },
};

export function createExample(): PromptFolder {
  return {
    name: "Test Prompts",
    prompts: [
      {
        id: crypto.randomUUID(),
        name: "Reaper Song Prompt",
        template: `Build a song in Reaper using the Reaper MCP. The song name is \${'Song Name':Text}. The genre is \${'Song Genre':Select:"Orchestra", "EDM", "Medieval"}. The BPM is \${'BPM':Text} and the expected length is \${'Expected Length':Text}. The key is \${'Key':Select:"A", "B", "C", "D", "E", "F", "G", "A Major", "B Major", "C Major", "D Major", "E Major", "F Major", "G Major", "A Minor", "B Minor", "C Minor", "D Minor", "E Minor", "F Minor", "G Minor"}. \${'Extra Details':Text}`,
        values: {
          "Song Name": "Midnight Lanterns",
          "Song Genre": "Orchestra",
          BPM: "154",
          "Expected Length": "2 minutes",
          Key: "A Major",
          "Extra Details": "It must include a bell.",
        },
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

export function validateFolderName(name: string): string | null {
  if (!name.trim()) return "Enter a folder name.";
  if (
    name !== name.trim() ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    name === "." ||
    name === ".."
  )
    return "Use a folder name without path separators or special characters.";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
    return "This name is reserved by Windows.";
  if (name.length > 100) return "Keep folder names under 100 characters.";
  return null;
}
