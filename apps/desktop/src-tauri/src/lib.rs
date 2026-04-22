mod claude_agent_host;
mod deep_link;
mod git;
mod llm_transport;
mod local_paths;
mod mcp_bridge;
mod runtime_secrets;

use tauri_plugin_sql::{Migration, MigrationKind};

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
    ]
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
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            runtime_secrets::runtime_secret_status,
            runtime_secrets::runtime_secret_set,
            runtime_secrets::runtime_secret_clear,
            claude_agent_host::claude_agent_execute,
            claude_agent_host::claude_agent_abort,
            llm_transport::llm_fetch,
            llm_transport::llm_fetch_abort,
            git::git_exec,
            local_paths::open_local_path,
            local_paths::save_deliverable_to_local,
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:offisim.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(mcp_bridge::init())
        .setup(|app| {
            // Resolve the plaintext secret-file location once so non-command
            // callers (llm_transport) can read without an AppHandle.
            runtime_secrets::init_storage(app.handle())
                .map_err(|e| format!("runtime_secrets init: {e}"))?;

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
                    if let Some(window) = app.get_webview_window("main") {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
