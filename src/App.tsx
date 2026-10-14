import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import {
  faCalendarDays,
  faCheck,
  faChevronDown,
  faChevronRight,
  faCode,
  faCopy,
  faFileLines,
  faFloppyDisk,
  faFolder,
  faFolderOpen,
  faFolderPlus,
  faGear,
  faPlus,
  faRotateRight,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { createExample, desktop, storage, validateFolderName } from "./library";
import type { Library, PromptDocument } from "./library";
import { parseTemplate, reconcileValues, renderPrompt } from "./template";
import { parseStoredDate } from "./dates";
import "./App.css";

const theme = createTheme({
  palette: {
    primary: { main: "#6552c7" },
    background: { default: "#f7f8fc", paper: "#ffffff" },
    text: { primary: "#25283b", secondary: "#75788c" },
  },
  typography: {
    fontFamily: '"Segoe UI", Inter, sans-serif',
    fontSize: 13,
    button: { textTransform: "none", fontWeight: 600 },
    h5: { fontWeight: 650, fontSize: "1.4rem" },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

interface Selection {
  folder: string;
  id: string;
}
const keyOf = (folder: string, id: string) => JSON.stringify([folder, id]);
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function CalendarIcon() {
  return <FontAwesomeIcon icon={faCalendarDays} />;
}

function App() {
  const [library, setLibrary] = useState<Library>({
    folders: [],
    warnings: [],
  });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [activeFolder, setActiveFolder] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [validSources, setValidSources] = useState<Record<string, string>>({});
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [createDialog, setCreateDialog] = useState<"folder" | "prompt">(
    "folder",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    run: () => Promise<void>;
  } | null>(null);

  const hydrate = useCallback((loaded: Library) => {
    const folders = loaded.folders.length ? loaded.folders : [createExample()];
    const fingerprints: Record<string, string> = {};
    const sources: Record<string, string> = {};
    folders.forEach((folder) =>
      folder.prompts.forEach((prompt) => {
        const key = keyOf(folder.name, prompt.id);
        if (loaded.folders.length) fingerprints[key] = JSON.stringify(prompt);
        try {
          parseTemplate(prompt.template);
          sources[key] = prompt.template;
        } catch {
          sources[key] = "";
        }
      }),
    );
    setLibrary({ folders, warnings: loaded.warnings });
    setSaved(fingerprints);
    setValidSources(sources);
    const firstFolder = folders.find((folder) => folder.prompts.length);
    setSelection(
      firstFolder
        ? { folder: firstFolder.name, id: firstFolder.prompts[0].id }
        : null,
    );
    setActiveFolder(firstFolder?.name ?? folders[0]?.name ?? "");
    setCollapsed([]);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([storage.getSettings(), storage.load()])
      .then(([settings, loaded]) => {
        if (!active) return;
        setDirectory(settings.directory);
        hydrate(loaded);
      })
      .catch((reason) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hydrate]);

  const prompt = library.folders
    .find((folder) => folder.name === selection?.folder)
    ?.prompts.find((item) => item.id === selection?.id);
  const selectedKey = selection ? keyOf(selection.folder, selection.id) : "";
  const dirty = !!prompt && saved[selectedKey] !== JSON.stringify(prompt);
  const anyDirty = library.folders.some((folder) =>
    folder.prompts.some(
      (item) => saved[keyOf(folder.name, item.id)] !== JSON.stringify(item),
    ),
  );
  const validation = useMemo(() => {
    try {
      return { parsed: parseTemplate(prompt?.template ?? ""), error: "" };
    } catch (reason) {
      return { parsed: null, error: messageOf(reason) };
    }
  }, [prompt?.template]);
  const parsed = useMemo(
    () => parseTemplate(validSources[selectedKey] ?? ""),
    [validSources, selectedKey],
  );
  const fieldValues = useMemo(
    () => reconcileValues(parsed.fields, prompt?.values ?? {}),
    [parsed, prompt?.values],
  );
  const generated = prompt ? renderPrompt(parsed, fieldValues) : "";

  const updatePrompt = useCallback(
    (changes: Partial<PromptDocument>) => {
      if (!selection) return;
      setLibrary((previous) => ({
        ...previous,
        folders: previous.folders.map((folder) =>
          folder.name !== selection.folder
            ? folder
            : {
                ...folder,
                prompts: folder.prompts.map((item) =>
                  item.id === selection.id ? { ...item, ...changes } : item,
                ),
              },
        ),
      }));
    },
    [selection],
  );

  const editTemplate = (template: string) => {
    if (!prompt) return;
    try {
      const next = parseTemplate(template);
      setValidSources((previous) => ({ ...previous, [selectedKey]: template }));
      updatePrompt({
        template,
        values: reconcileValues(next.fields, prompt.values),
      });
    } catch {
      updatePrompt({ template });
    }
  };

  const savePrompt = useCallback(async () => {
    if (!prompt || !selection || busy || loading) return;
    if (!prompt.name.trim()) {
      setError("Enter a name for this prompt before saving.");
      return;
    }
    if (validation.error) {
      setError("Fix the template error before saving.");
      return;
    }
    setBusy(true);
    setError("");
    const document = {
      ...prompt,
      name: prompt.name.trim(),
      values: reconcileValues(parsed.fields, prompt.values),
      updatedAt: new Date().toISOString(),
    };
    try {
      await storage.save(selection.folder, document);
      updatePrompt(document);
      setSaved((previous) => ({
        ...previous,
        [selectedKey]: JSON.stringify(document),
      }));
      setNotice(
        desktop
          ? "Prompt saved to your library."
          : "Prompt saved in this browser.",
      );
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }, [
    prompt,
    selection,
    busy,
    loading,
    validation.error,
    parsed,
    updatePrompt,
    selectedKey,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void savePrompt();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (anyDirty) event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [savePrompt, anyDirty]);

  // Tauri window-close requests are separate from browser navigation.
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        const listener = await appWindow.onCloseRequested((event) => {
          if (anyDirty) {
            event.preventDefault();
            setConfirmation({
              run: async () => {
                await appWindow.destroy();
              },
            });
          }
        });
        if (disposed) listener();
        else unlisten = listener;
      })
      .catch((reason) => setError(messageOf(reason)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [anyDirty]);

  const guardUnsaved = (run: () => Promise<void>) => {
    if (anyDirty) setConfirmation({ run });
    else void run();
  };
  const showCreate = (kind: "folder" | "prompt") => {
    setMenuAnchor(null);
    setNewName("");
    setCreateError("");
    setCreateDialog(kind);
    setCreateOpen(true);
  };
  const createItem = async () => {
    const name = newName.trim();
    const problem =
      createDialog === "folder"
        ? validateFolderName(name)
        : !name
          ? "Enter a prompt name."
          : null;
    if (problem) {
      setCreateError(problem);
      return;
    }
    setBusy(true);
    try {
      if (createDialog === "folder") {
        if (
          library.folders.some(
            (folder) => folder.name.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error("A folder with this name already exists.");
        await storage.createFolder(name);
        setLibrary((previous) => ({
          ...previous,
          folders: [...previous.folders, { name, prompts: [] }],
        }));
        setActiveFolder(name);
        setSelection(null);
        setNotice("Folder created.");
      } else {
        if (!activeFolder) throw new Error("Create a folder first.");
        const document: PromptDocument = {
          id: crypto.randomUUID(),
          name,
          template: `Write about \${'Topic':Text} in a \${'Tone':Select:"Friendly", "Professional", "Concise"} tone.`,
          values: { Topic: "", Tone: "Friendly" },
          updatedAt: new Date().toISOString(),
        };
        setLibrary((previous) => ({
          ...previous,
          folders: previous.folders.map((folder) =>
            folder.name === activeFolder
              ? { ...folder, prompts: [...folder.prompts, document] }
              : folder,
          ),
        }));
        setValidSources((previous) => ({
          ...previous,
          [keyOf(activeFolder, document.id)]: document.template,
        }));
        setSelection({ folder: activeFolder, id: document.id });
        setCollapsed((previous) =>
          previous.filter((name) => name !== activeFolder),
        );
      }
      setCreateOpen(false);
    } catch (reason) {
      setCreateError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      hydrate(await storage.load());
      setError("");
      setNotice("Library reloaded.");
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const showSettings = () => {
    setDirectoryDraft(directory);
    setSettingsError("");
    setSettingsOpen(true);
  };
  const applyDirectory = async () => {
    setBusy(true);
    try {
      const settings = await storage.setDirectory(directoryDraft.trim());
      setDirectory(settings.directory);
      hydrate(await storage.load());
      setSettingsOpen(false);
      setError("");
      setNotice("Save directory updated.");
    } catch (reason) {
      setSettingsError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose your prompt library directory",
      });
      if (typeof selected === "string") setDirectoryDraft(selected);
    } catch (reason) {
      setSettingsError(messageOf(reason));
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(generated);
      setNotice("Generated prompt copied.");
    } catch {
      setError(
        "Clipboard access failed. Select the generated text and copy it manually.",
      );
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className="app-shell">
        <header className="menu-bar">
          <div className="brand-mark">
            <FontAwesomeIcon icon={faWandMagicSparkles} />
          </div>
          <Typography className="brand-name" sx={{ fontWeight: 650 }}>
            Prompt Builder
          </Typography>
          <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 1.5 }} />
          <Button
            color="inherit"
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            File
          </Button>
          <Button color="inherit" onClick={showSettings}>
            Settings
          </Button>
          <Button color="inherit" onClick={() => setAboutOpen(true)}>
            About
          </Button>
          <span className="menu-spacer" />
          <Chip
            className="mode-chip"
            size="small"
            variant="outlined"
            label={desktop ? "Local workspace" : "Browser preview"}
          />
        </header>

        <div className="workspace">
          <aside className="sidebar" aria-label="Prompt library">
            <div className="sidebar-heading">
              <Typography variant="overline">YOUR LIBRARY</Typography>
              <Tooltip title="New folder">
                <IconButton
                  size="small"
                  aria-label="New folder"
                  disabled={busy || loading}
                  onClick={() => showCreate("folder")}
                >
                  <FontAwesomeIcon icon={faFolderPlus} />
                </IconButton>
              </Tooltip>
            </div>
            <List className="folder-list" disablePadding>
              {library.folders.map((folder) => {
                const expanded = !collapsed.includes(folder.name);
                return (
                  <Box key={folder.name}>
                    <ListItemButton
                      className="folder-row"
                      selected={activeFolder === folder.name && !selection}
                      disabled={busy}
                      onClick={() => {
                        setActiveFolder(folder.name);
                        setCollapsed((previous) =>
                          expanded
                            ? [...previous, folder.name]
                            : previous.filter((name) => name !== folder.name),
                        );
                      }}
                    >
                      <FontAwesomeIcon
                        className="folder-chevron"
                        icon={expanded ? faChevronDown : faChevronRight}
                      />
                      <ListItemIcon sx={{ minWidth: 28, color: "#b39551" }}>
                        <FontAwesomeIcon
                          icon={expanded ? faFolderOpen : faFolder}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={folder.name}
                        slotProps={{
                          primary: {
                            sx: { fontSize: 13, fontWeight: 600 },
                            noWrap: true,
                          },
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {folder.prompts.length}
                      </Typography>
                    </ListItemButton>
                    <Collapse in={expanded}>
                      <div className="folder-children">
                        {folder.prompts.map((item) => (
                          <ListItemButton
                            className="prompt-row"
                            key={item.id}
                            disabled={busy}
                            selected={
                              selection?.id === item.id &&
                              selection?.folder === folder.name
                            }
                            onClick={() => {
                              setSelection({
                                folder: folder.name,
                                id: item.id,
                              });
                              setActiveFolder(folder.name);
                            }}
                          >
                            <ListItemIcon
                              sx={{ minWidth: 25, color: "inherit" }}
                            >
                              <FontAwesomeIcon icon={faFileLines} />
                            </ListItemIcon>
                            <ListItemText
                              primary={item.name || "Untitled prompt"}
                              slotProps={{
                                primary: { sx: { fontSize: 12 }, noWrap: true },
                              }}
                            />
                            {saved[keyOf(folder.name, item.id)] !==
                              JSON.stringify(item) && (
                              <span
                                className="unsaved-dot"
                                title="Unsaved changes"
                              />
                            )}
                          </ListItemButton>
                        ))}
                        <Button
                          className="new-prompt"
                          size="small"
                          color="inherit"
                          disabled={busy || loading}
                          startIcon={<FontAwesomeIcon icon={faPlus} />}
                          onClick={() => {
                            setActiveFolder(folder.name);
                            showCreate("prompt");
                          }}
                        >
                          New prompt
                        </Button>
                      </div>
                    </Collapse>
                  </Box>
                );
              })}
            </List>
            <Button
              className="new-folder"
              color="inherit"
              startIcon={<FontAwesomeIcon icon={faFolderPlus} />}
              disabled={busy || loading}
              onClick={() => showCreate("folder")}
            >
              New folder
            </Button>
            <div className="sidebar-bottom">
              <FontAwesomeIcon icon={faFloppyDisk} />
              <Typography variant="caption">
                {desktop ? "Saved on your device" : "Saved in this browser"}
              </Typography>
              <Tooltip title="Library settings">
                <IconButton
                  size="small"
                  aria-label="Library settings"
                  onClick={showSettings}
                >
                  <FontAwesomeIcon icon={faGear} />
                </IconButton>
              </Tooltip>
            </div>
          </aside>

          <main className="main-content">
            {error && (
              <Alert
                severity="error"
                onClose={() => setError("")}
                sx={{ mb: 2 }}
              >
                {error}
              </Alert>
            )}
            {library.warnings.map((warning) => (
              <Alert key={warning} severity="warning" sx={{ mb: 2 }}>
                {warning}
              </Alert>
            ))}
            {loading ? (
              <div className="empty-state">
                <CircularProgress size={30} />
                <Typography>Opening your library…</Typography>
              </div>
            ) : prompt ? (
              <>
                <div className="document-header">
                  <div className="document-title">
                    <Typography variant="caption" color="text.secondary">
                      {selection?.folder}{" "}
                      <span className="breadcrumb-slash">/</span> Prompt
                    </Typography>
                    <TextField
                      className="name-input"
                      variant="standard"
                      value={prompt.name}
                      disabled={busy}
                      onChange={(event) =>
                        updatePrompt({ name: event.target.value })
                      }
                      slotProps={{
                        input: { disableUnderline: true },
                        htmlInput: {
                          "aria-label": "Prompt name",
                          maxLength: 150,
                        },
                      }}
                    />
                  </div>
                  <div className="save-actions">
                    <Typography variant="caption" color="text.secondary">
                      {dirty ? "Unsaved changes" : "All changes saved"}
                    </Typography>
                    <Button
                      variant="contained"
                      disabled={
                        busy || !!validation.error || !prompt.name.trim()
                      }
                      startIcon={
                        busy ? (
                          <CircularProgress size={13} color="inherit" />
                        ) : (
                          <FontAwesomeIcon icon={faFloppyDisk} />
                        )
                      }
                      onClick={() => void savePrompt()}
                    >
                      Save prompt
                    </Button>
                  </div>
                </div>

                <Paper variant="outlined" className="editor-card options-card">
                  <div className="card-heading">
                    <div className="heading-icon">
                      <FontAwesomeIcon icon={faWandMagicSparkles} />
                    </div>
                    <div>
                      <Typography sx={{ fontWeight: 650 }}>
                        Prompt options
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Make it yours. Your prompt updates as you type.
                      </Typography>
                    </div>
                    <Chip
                      size="small"
                      label={`${parsed.fields.length} ${parsed.fields.length === 1 ? "field" : "fields"}`}
                      className="subtle-chip"
                    />
                  </div>
                  <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <div className="fields-grid">
                      {parsed.fields.map((field) =>
                        field.kind === "Toggle" ? (
                          <Box key={field.name} className="toggle-field">
                            <FormControlLabel
                              label={field.name}
                              disabled={busy}
                              slotProps={{
                                typography: {
                                  sx: { fontSize: 13, fontWeight: 600 },
                                },
                              }}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={fieldValues[field.name] === "true"}
                                  onChange={(_, checked) =>
                                    updatePrompt({
                                      values: {
                                        ...prompt.values,
                                        [field.name]: String(checked),
                                      },
                                    })
                                  }
                                />
                              }
                            />
                          </Box>
                        ) : field.kind === "Date" ? (
                          <DatePicker
                            key={field.name}
                            label={field.name}
                            format={field.format}
                            value={parseStoredDate(fieldValues[field.name])}
                            disabled={busy}
                            slots={{ openPickerIcon: CalendarIcon }}
                            slotProps={{
                              textField: { size: "small", fullWidth: true },
                              field: {
                                clearable: true,
                                shouldRespectLeadingZeros: true,
                              },
                            }}
                            onChange={(date, context) => {
                              if (context.validationError != null) return;
                              updatePrompt({
                                values: {
                                  ...prompt.values,
                                  [field.name]:
                                    date?.format("YYYY-MM-DD") ?? "",
                                },
                              });
                            }}
                          />
                        ) : (
                          <TextField
                            key={field.name}
                            className={
                              field.kind === "TextArea"
                                ? "textarea-field"
                                : undefined
                            }
                            label={field.name}
                            value={fieldValues[field.name]}
                            select={field.kind === "Select"}
                            multiline={field.kind === "TextArea"}
                            rows={field.kind === "TextArea" ? 3 : undefined}
                            slotProps={{
                              input:
                                field.kind === "TextArea"
                                  ? { inputComponent: "textarea" }
                                  : undefined,
                            }}
                            fullWidth
                            disabled={busy}
                            onChange={(event) =>
                              updatePrompt({
                                values: {
                                  ...prompt.values,
                                  [field.name]: event.target.value,
                                },
                              })
                            }
                          >
                            {field.kind === "Select"
                              ? field.options.map((option) => (
                                  <MenuItem key={option} value={option}>
                                    {option}
                                  </MenuItem>
                                ))
                              : undefined}
                          </TextField>
                        ),
                      )}
                      {!parsed.fields.length && (
                        <Typography color="text.secondary" variant="body2">
                          Add Text, TextArea, Select, Toggle, or Date fields to
                          your template to see options here.
                        </Typography>
                      )}
                    </div>
                  </LocalizationProvider>
                </Paper>

                <Paper variant="outlined" className="editor-card result-card">
                  <div className="card-heading">
                    <div className="heading-icon">
                      <FontAwesomeIcon icon={faFileLines} />
                    </div>
                    <div>
                      <Typography sx={{ fontWeight: 650 }}>
                        Generated prompt
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Ready for your next conversation.
                      </Typography>
                    </div>
                    <Tooltip title="Copy generated prompt">
                      <IconButton
                        aria-label="Copy generated prompt"
                        onClick={() => void copyPrompt()}
                        disabled={!generated}
                      >
                        <FontAwesomeIcon icon={faCopy} />
                      </IconButton>
                    </Tooltip>
                  </div>
                  <Typography
                    className="generated-text"
                    component="div"
                    aria-label="Generated prompt"
                    aria-live="polite"
                  >
                    {generated || "Your generated prompt will appear here."}
                  </Typography>
                  <div className="result-footer">
                    <Typography variant="caption" color="text.secondary">
                      {generated.length.toLocaleString()} characters{" "}
                      <span className="footer-dot">·</span> Updates
                      automatically
                    </Typography>
                    <Button
                      size="small"
                      startIcon={<FontAwesomeIcon icon={faCopy} />}
                      disabled={!generated}
                      onClick={() => void copyPrompt()}
                    >
                      Copy prompt
                    </Button>
                  </div>
                </Paper>

                <Paper variant="outlined" className="editor-card template-card">
                  <div className="card-heading">
                    <div className="heading-icon neutral">
                      <FontAwesomeIcon icon={faCode} />
                    </div>
                    <div>
                      <Typography sx={{ fontWeight: 650 }}>Template</Typography>
                      <Typography variant="caption" color="text.secondary">
                        The starting point for your prompt.
                      </Typography>
                    </div>
                    <Chip
                      size="small"
                      color={validation.error ? "error" : "success"}
                      variant="outlined"
                      icon={
                        <FontAwesomeIcon
                          icon={validation.error ? faCode : faCheck}
                        />
                      }
                      label={
                        validation.error ? "Needs attention" : "Valid template"
                      }
                    />
                  </div>
                  <TextField
                    className="template-input"
                    fullWidth
                    multiline
                    minRows={5}
                    value={prompt.template}
                    disabled={busy}
                    error={!!validation.error}
                    onChange={(event) => editTemplate(event.target.value)}
                    slotProps={{
                      htmlInput: {
                        "aria-label": "Template text",
                        spellCheck: false,
                      },
                    }}
                  />
                  <div className="syntax-help">
                    <Typography variant="caption" color="text.secondary">
                      Add a field
                    </Typography>
                    <code>{"${'Label':Text}"}</code>
                    <code>{"${'Label':TextArea}"}</code>
                    <code>{'${\'Label\':Select:"Option 1","Option 2"}'}</code>
                    <code>{'${\'Label\':Toggle:"Yes text","No text"}'}</code>
                    <code>{"${'Label':Date:\"MM/DD/YYYY\"}"}</code>
                  </div>
                  {validation.error && (
                    <Alert severity="error" sx={{ mt: 1.5 }}>
                      {validation.error}. Options and output show the last valid
                      template.
                    </Alert>
                  )}
                </Paper>
              </>
            ) : (
              <div className="empty-state">
                <FontAwesomeIcon icon={faFolderOpen} size="2x" />
                <Typography variant="h5">
                  {activeFolder ? "A fresh folder" : "Your prompt library"}
                </Typography>
                <Typography color="text.secondary">
                  {activeFolder
                    ? "Create a prompt to start building."
                    : "Choose a save directory in Settings or create a folder."}
                </Typography>
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => showCreate(activeFolder ? "prompt" : "folder")}
                  startIcon={<FontAwesomeIcon icon={faPlus} />}
                >
                  {activeFolder ? "New prompt" : "New folder"}
                </Button>
              </div>
            )}
            <footer className="workspace-footer">
              <span className="status-light" />
              <Typography variant="caption" color="text.secondary">
                {desktop ? "Local library" : "Browser preview"}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                className="directory-path"
                title={directory}
              >
                {directory}
              </Typography>
            </footer>
          </main>
        </div>
      </div>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          disabled={busy || loading}
          onClick={() => showCreate("prompt")}
        >
          <ListItemIcon>
            <FontAwesomeIcon icon={faPlus} />
          </ListItemIcon>
          New prompt
        </MenuItem>
        <MenuItem
          disabled={busy || loading}
          onClick={() => showCreate("folder")}
        >
          <ListItemIcon>
            <FontAwesomeIcon icon={faFolderPlus} />
          </ListItemIcon>
          New folder
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={!prompt || busy || loading || !!validation.error}
          onClick={() => {
            setMenuAnchor(null);
            void savePrompt();
          }}
        >
          <ListItemIcon>
            <FontAwesomeIcon icon={faFloppyDisk} />
          </ListItemIcon>
          Save prompt
          <Typography variant="caption" color="text.secondary" sx={{ ml: 4 }}>
            Ctrl+S
          </Typography>
        </MenuItem>
        <MenuItem
          disabled={busy || loading}
          onClick={() => {
            setMenuAnchor(null);
            guardUnsaved(reload);
          }}
        >
          <ListItemIcon>
            <FontAwesomeIcon icon={faRotateRight} />
          </ListItemIcon>
          Reload library
        </MenuItem>
      </Menu>

      <Dialog
        open={createOpen}
        onClose={() => {
          if (!busy) setCreateOpen(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void createItem();
          }}
        >
          <DialogTitle>
            {createDialog === "folder" ? "New folder" : "New prompt"}
          </DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {createDialog === "folder"
                ? "Keep related prompts together in a folder."
                : `Create a prompt in ${activeFolder || "your library"}.`}
            </DialogContentText>
            <TextField
              autoFocus
              fullWidth
              label={createDialog === "folder" ? "Folder name" : "Prompt name"}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setCreateError("");
              }}
              disabled={busy}
              error={!!createError}
              helperText={createError}
              slotProps={{
                htmlInput: { maxLength: createDialog === "folder" ? 100 : 150 },
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={busy || !newName.trim()}
              type="submit"
            >
              Create {createDialog}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={settingsOpen}
        onClose={() => {
          if (!busy) setSettingsOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Settings</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1, fontWeight: 600 }}>
            Prompt save directory
          </Typography>
          <DialogContentText sx={{ mb: 2 }}>
            Your folders, templates, and field values are saved here. Choose
            another directory to open a different library. Existing files stay
            in their current directory.
          </DialogContentText>
          {!desktop && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Browser preview saves in this browser. Open the desktop app to
              choose a directory on your device.
            </Alert>
          )}
          <div className="directory-picker">
            <TextField
              fullWidth
              label="Save directory"
              value={directoryDraft}
              disabled={!desktop || busy}
              onChange={(event) => setDirectoryDraft(event.target.value)}
            />
            <Button
              variant="outlined"
              disabled={!desktop || busy}
              startIcon={<FontAwesomeIcon icon={faFolderOpen} />}
              onClick={() => void browse()}
            >
              Browse
            </Button>
          </div>
          {settingsError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {settingsError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={
              !desktop ||
              busy ||
              !directoryDraft.trim() ||
              directoryDraft.trim() === directory
            }
            onClick={() => guardUnsaved(applyDirectory)}
          >
            Use directory
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>About Prompt Builder</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Create reusable prompts with text fields and dropdowns. Templates
            and live generation run on your device. Your library is stored
            locally.
          </DialogContentText>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 2 }}
          >
            Version 0.1.0 · Material UI · Font Awesome Free
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAboutOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        maxWidth="xs"
      >
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved prompts. Continuing will discard those edits.
            Cancel to save them first.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmation(null)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              const action = confirmation;
              setConfirmation(null);
              void action?.run().catch((reason) => setError(messageOf(reason)));
            }}
          >
            Discard and continue
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!notice}
        autoHideDuration={3500}
        onClose={() => setNotice("")}
        message={notice}
      />
    </ThemeProvider>
  );
}

export default App;
