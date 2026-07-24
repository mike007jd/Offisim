use serde_json::{json, Value};

const SOURCE_URL: &str = "https://learn.chatgpt.com/docs/config-file/config-reference";
const CHECKED_AT: &str = "2026-07-24";

pub(crate) fn codex_run_options() -> Value {
    let standard_efforts = ["minimal", "low", "medium", "high", "xhigh"];
    let compact_efforts = ["minimal", "low", "medium", "high"];
    let speed_modes = ["standard", "fast"];

    json!({
        "models": [
            {
                "id": "gpt-5.6-sol",
                "displayName": "GPT-5.6 Sol",
                "isDefault": true,
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.6-terra",
                "displayName": "GPT-5.6 Terra",
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.6-luna",
                "displayName": "GPT-5.6 Luna",
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.5",
                "displayName": "GPT-5.5",
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.4",
                "displayName": "GPT-5.4",
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.4-mini",
                "displayName": "GPT-5.4 Mini",
                "reasoningEfforts": compact_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
            {
                "id": "gpt-5.3-codex-spark",
                "displayName": "GPT-5.3 Codex Spark",
                "note": "Preview",
                "reasoningEfforts": standard_efforts,
                "defaultReasoningEffort": "medium",
                "speedModes": speed_modes,
            },
        ],
        "sourceUrl": SOURCE_URL,
        "checkedAt": CHECKED_AT,
    })
}
