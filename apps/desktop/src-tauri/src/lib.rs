mod builtin_tools;
mod claude_agent_host;
mod codex_agent_host;
mod deep_link;
mod git;
mod kanban;
mod llm_transport;
mod local_db;
mod local_paths;
mod mcp_bridge;
mod resume;
mod runtime_secrets;
mod sessions;
mod sidecar_stderr;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_FALLBACK_LABEL: &str = "main-live";

fn create_main_window_with_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Offisim")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .visible(true)
        .focused(true)
        .center()
        .build()
}

fn create_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    create_main_window_with_label(app, MAIN_WINDOW_LABEL)
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "core tables",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/001_core_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "install tables",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/002_install_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "runtime orchestration",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/003_runtime_orchestration.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "audit and events",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/004_audit_and_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "llm calls tracking",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/005_llm_calls.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "langgraph checkpoint tables",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/006_langgraph_checkpoints.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "mcp audit log",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/007_mcp_audit_log.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "agent memory system",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/008_memory_system.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "employee version history",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/009_employee_versions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "model cost rates",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/010_model_cost_rates.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "sop templates and steps",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/011_sop_templates.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "office layouts",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/012_office_layouts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "library documents",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/013_library_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "workstation-rack bindings",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/014_workstation_racks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "prefab instances",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/015_prefab_instances.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "projects and graph_threads fix",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/016_projects.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "project-employee assignments",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/017_project_assignments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "agent events for event sourcing",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/018_agent_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "recovery knowledge",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/019_recovery_knowledge.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "sop template remote source",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/020_sop_template_remote.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "installed package marketplace provenance",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/021_installed_packages_provenance.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "file history",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/022_file_history.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "thread compact baseline",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/023_thread_compact_baseline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "durable interactions",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/024_durable_interactions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "mcp audit fk fix",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/025_fix_mcp_audit_fk.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "company template metadata",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/026_company_template_metadata.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "zones",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/027_zones.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "memory entries v2",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/028_memory_entries_v2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "deliverables history",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/029_deliverables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "employees external a2a",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/030_employees_external_a2a.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "skills two-tier schema",
            sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/031_skills.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "graph threads synopsis",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/032_graph_threads_synopsis.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "middleware summary tables",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/033_middleware_summary_tables.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "projects workspace root binding",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/034_projects_workspace_root.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "skills self-authored source kind",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/035_skills_self_authored_source_kind.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "deterministic harness foundation",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/036_deterministic_harness_foundation.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "tool permission approval company lookup index",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/037_tool_permission_approval_company_lookup.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 38,
            description: "kanban cards",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/038_kanban_cards.sql"
            ),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 39,
            description: "session interaction mode",
            sql: include_str!(
                "../../../../Docs/03_migrations/offisim_migrations_local_v0.1/039_session_interaction_mode.sql"
            ),
            kind: MigrationKind::Up,
        },
    ]
}

fn restore_main_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    window.is_visible().unwrap_or(false)
}

fn ensure_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let window = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => window,
        None => create_main_window(app)?,
    };
    if restore_main_window(&window) {
        return Ok(());
    }
    let fallback = match app.get_webview_window(MAIN_WINDOW_FALLBACK_LABEL) {
        Some(window) => window,
        None => create_main_window_with_label(app, MAIN_WINDOW_FALLBACK_LABEL)?,
    };
    restore_main_window(&fallback);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be registered first — the handler short-circuits
        // subsequent launches before any DB/plugin init runs. Without it a
        // second `cargo tauri dev` / binary launch hits the SQLite write lock
        // held by the running instance (tauri-plugin-sql opens offisim.db in
        // the shared appDataDir) and the second window hangs with a black
        // webview. The callback focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let _ = ensure_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            runtime_secrets::runtime_secret_status,
            runtime_secrets::runtime_secret_set,
            runtime_secrets::runtime_secret_clear,
            runtime_secrets::trusted_host_product_status,
            builtin_tools::project_read_file,
            builtin_tools::project_list_dir,
            builtin_tools::project_write_file,
            builtin_tools::bash_execute,
            claude_agent_host::claude_agent_execute,
            claude_agent_host::claude_agent_abort,
            codex_agent_host::codex_agent_execute,
            codex_agent_host::codex_agent_abort,
            llm_transport::llm_fetch,
            llm_transport::llm_fetch_abort,
            git::git_exec,
            local_paths::open_local_path,
            local_paths::save_deliverable_to_local,
            resume::resume_conversation,
            sessions::get_session,
            sessions::set_session_mode,
            kanban::list_kanban_cards,
            kanban::create_kanban_card,
            kanban::transition_kanban_card,
            kanban::count_kanban_for_employee,
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:offisim.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(mcp_bridge::init())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.window();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .setup(|app| {
            tauri::async_runtime::block_on(local_db::init_offisim_db_state(app.handle()))
                .map_err(|e| format!("local_db init: {e}"))?;

            // Resolve the plaintext secret-file location once so non-command
            // callers (llm_transport) can read without an AppHandle.
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            runtime_secrets::init_storage(app.handle())
                .map_err(|e| format!("runtime_secrets init: {e}"))?;

            // macOS state restoration can relaunch the process without an
            // accessibility-visible main window after a previous close. Bring
            // the configured window back explicitly so release desktop live
            // verification and normal relaunches land on the usable app.
            {
                ensure_main_window(app.handle()).map_err(|e| format!("main window init: {e}"))?;
            }

            // Open devtools on launch. Gated only by the OFFISIM_DESKTOP_DEVTOOLS
            // env var at startup so live verify from release .app bundles can
            // flip it on (Computer Use only attaches to .app bundles, not to
            // `target/debug/offisim-desktop` bare binaries). Debug builds keep
            // the previous always-on behaviour.
            {
                use tauri::Manager;
                let force_devtools = std::env::var("OFFISIM_DESKTOP_DEVTOOLS")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                if cfg!(debug_assertions) || force_devtools {
                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        window.open_devtools();
                    } else if let Some(window) = app.get_webview_window(MAIN_WINDOW_FALLBACK_LABEL)
                    {
                        window.open_devtools();
                    }
                }
            }

            // Register deep link scheme on platforms that need runtime registration
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Listen for incoming deep link URLs
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    deep_link::handle_deep_link_urls(&handle, event.urls().to_vec());
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = ensure_main_window(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } if !has_visible_windows => {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = ensure_main_window(app);
            }
            _ => {}
        });
}
