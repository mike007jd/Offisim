use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Wry};

const REGISTRY_FILE: &str = "mcp-servers.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMcpServer {
    pub server_id: String,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRegistrationInput {
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
}

pub struct RegisteredServerStore {
    file_path: PathBuf,
    servers: Mutex<HashMap<String, RegisteredMcpServer>>,
}

impl RegisteredServerStore {
    pub fn load(app: &AppHandle<Wry>) -> Result<Self, String> {
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let file_path = app_data_dir.join(REGISTRY_FILE);

        let servers = load_registry_entries(&file_path)?;

        Ok(Self {
            file_path,
            servers: Mutex::new(servers),
        })
    }

    pub fn list(&self) -> Result<Vec<RegisteredMcpServer>, String> {
        let servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        let mut values = servers.values().cloned().collect::<Vec<_>>();
        values.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(values)
    }

    pub fn get(&self, server_id: &str) -> Result<Option<RegisteredMcpServer>, String> {
        let servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        Ok(servers.get(server_id).cloned())
    }

    pub fn register(
        &self,
        input: McpServerRegistrationInput,
    ) -> Result<RegisteredMcpServer, String> {
        self.validate(&input)?;

        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        if servers.values().any(|existing| existing.name == input.name) {
            return Err(format!("MCP server '{}' already exists", input.name));
        }

        let server = RegisteredMcpServer {
            server_id: generate_server_id(&input.name),
            name: input.name.trim().to_string(),
            transport: input.transport,
            command: input
                .command
                .as_ref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            args: input
                .args
                .into_iter()
                .map(|arg| arg.trim().to_string())
                .filter(|arg| !arg.is_empty())
                .collect(),
            url: input
                .url
                .as_ref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
        };

        servers.insert(server.server_id.clone(), server.clone());
        self.persist_locked(&servers)?;
        Ok(server)
    }

    pub fn unregister(&self, server_id: &str) -> Result<(), String> {
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        servers.remove(server_id);
        self.persist_locked(&servers)
    }

    fn validate(&self, input: &McpServerRegistrationInput) -> Result<(), String> {
        if input.name.trim().is_empty() {
            return Err("Server name is required".into());
        }

        match input.transport {
            McpTransport::Stdio => {
                if input
                    .command
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
                {
                    return Err("Command is required for stdio MCP servers".into());
                }
            }
            McpTransport::Sse => {
                if input
                    .url
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
                {
                    return Err("URL is required for SSE MCP servers".into());
                }
            }
        }

        Ok(())
    }

    fn persist_locked(&self, servers: &HashMap<String, RegisteredMcpServer>) -> Result<(), String> {
        let mut values = servers.values().cloned().collect::<Vec<_>>();
        values.sort_by(|a, b| a.name.cmp(&b.name));
        let raw = serde_json::to_string_pretty(&values).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, raw).map_err(|e| e.to_string())
    }
}

fn load_registry_entries(file_path: &Path) -> Result<HashMap<String, RegisteredMcpServer>, String> {
    if !file_path.exists() {
        return Ok(HashMap::new());
    }

    let raw = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Vec<RegisteredMcpServer>>(&raw) {
        Ok(entries) => Ok(entries
            .into_iter()
            .map(|server| (server.server_id.clone(), server))
            .collect()),
        Err(err) => {
            eprintln!(
                "[mcp_bridge] ignoring malformed MCP registry at {}: {}",
                file_path.display(),
                err
            );
            Ok(HashMap::new())
        }
    }
}

fn generate_server_id(name: &str) -> String {
    let slug = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let suffix = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect::<String>()
        .to_ascii_lowercase();
    if slug.is_empty() {
        format!("mcp-{suffix}")
    } else {
        format!("mcp-{slug}-{suffix}")
    }
}
