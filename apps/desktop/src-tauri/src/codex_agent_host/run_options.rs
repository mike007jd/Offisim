use serde_json::{json, Value};

const SOURCE_URL: &str = "https://learn.chatgpt.com/docs/config-file/config-reference";
const CHECKED_AT: &str = "2026-07-24";
const STANDARD_EFFORTS: &[&str] = &["minimal", "low", "medium", "high", "xhigh"];
const COMPACT_EFFORTS: &[&str] = &["minimal", "low", "medium", "high"];
const SPEED_MODES: &[&str] = &["standard", "fast"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodexRunOptionModel {
    pub(crate) id: &'static str,
    display_name: &'static str,
    is_default: bool,
    note: Option<&'static str>,
    reasoning_efforts: &'static [&'static str],
    default_reasoning_effort: &'static str,
    speed_modes: &'static [&'static str],
}

const CODEX_RUN_OPTION_MODELS: &[CodexRunOptionModel] = &[
    CodexRunOptionModel {
        id: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        is_default: true,
        note: None,
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        is_default: false,
        note: None,
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        is_default: false,
        note: None,
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.5",
        display_name: "GPT-5.5",
        is_default: false,
        note: None,
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.4",
        display_name: "GPT-5.4",
        is_default: false,
        note: None,
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.4-mini",
        display_name: "GPT-5.4 Mini",
        is_default: false,
        note: None,
        reasoning_efforts: COMPACT_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
    CodexRunOptionModel {
        id: "gpt-5.3-codex-spark",
        display_name: "GPT-5.3 Codex Spark",
        is_default: false,
        note: Some("Preview"),
        reasoning_efforts: STANDARD_EFFORTS,
        default_reasoning_effort: "medium",
        speed_modes: SPEED_MODES,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ValidatedCodexRunSelection {
    pub(crate) requested_model: Option<&'static str>,
    pub(crate) effort: Option<&'static str>,
    pub(crate) service_tier: Option<&'static str>,
}

pub(crate) fn codex_run_option_model(model_id: &str) -> Option<&'static CodexRunOptionModel> {
    CODEX_RUN_OPTION_MODELS
        .iter()
        .find(|model| model.id == model_id)
}

fn default_codex_run_option_model() -> &'static CodexRunOptionModel {
    CODEX_RUN_OPTION_MODELS
        .iter()
        .find(|model| model.is_default)
        .expect("Codex run options must declare one default model")
}

pub(crate) fn validate_codex_run_selection(
    model_id: &str,
    effort: Option<&str>,
    speed_mode: Option<&str>,
) -> Result<ValidatedCodexRunSelection, String> {
    let (model, requested_model) = if model_id == "engine-managed" {
        (default_codex_run_option_model(), None)
    } else {
        let model = codex_run_option_model(model_id).ok_or_else(|| {
            format!("The saved Codex model \"{model_id}\" is no longer available.")
        })?;
        (model, Some(model.id))
    };

    let effort = effort
        .map(|effort| {
            model
                .reasoning_efforts
                .iter()
                .copied()
                .find(|candidate| *candidate == effort)
                .ok_or_else(|| {
                    format!(
                        "Codex reasoning effort \"{effort}\" is not available for model \"{}\".",
                        model.id
                    )
                })
        })
        .transpose()?;

    let service_tier = match speed_mode {
        None | Some("standard") => {
            if speed_mode.is_some() && !model.speed_modes.contains(&"standard") {
                return Err(format!(
                    "Codex standard speed is not available for model \"{}\".",
                    model.id
                ));
            }
            None
        }
        Some("fast") if model.speed_modes.contains(&"fast") => Some("fast"),
        Some("fast") => {
            return Err(format!(
                "Codex fast mode is not available for model \"{}\".",
                model.id
            ))
        }
        Some(speed_mode) => {
            return Err(format!(
                "Unknown Codex speed mode \"{speed_mode}\". Expected standard or fast."
            ))
        }
    };

    Ok(ValidatedCodexRunSelection {
        requested_model,
        effort,
        service_tier,
    })
}

pub(crate) fn codex_run_options() -> Value {
    let models = CODEX_RUN_OPTION_MODELS
        .iter()
        .map(|model| {
            let mut value = json!({
                "id": model.id,
                "displayName": model.display_name,
                "reasoningEfforts": model.reasoning_efforts,
                "defaultReasoningEffort": model.default_reasoning_effort,
                "speedModes": model.speed_modes,
            });
            let object = value
                .as_object_mut()
                .expect("Codex run option model must encode as an object");
            if model.is_default {
                object.insert("isDefault".into(), Value::Bool(true));
            }
            if let Some(note) = model.note {
                object.insert("note".into(), Value::String(note.into()));
            }
            value
        })
        .collect::<Vec<_>>();

    json!({
        "models": models,
        "sourceUrl": SOURCE_URL,
        "checkedAt": CHECKED_AT,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn typed_catalog_has_one_default_and_valid_declarations() {
        assert_eq!(
            CODEX_RUN_OPTION_MODELS
                .iter()
                .filter(|model| model.is_default)
                .count(),
            1
        );
        let mut ids = HashSet::new();
        for model in CODEX_RUN_OPTION_MODELS {
            assert!(ids.insert(model.id), "duplicate Codex model {}", model.id);
            assert!(
                model
                    .reasoning_efforts
                    .contains(&model.default_reasoning_effort),
                "default effort must be selectable for {}",
                model.id
            );
            assert!(model.speed_modes.contains(&"standard"));
            assert!(model.speed_modes.contains(&"fast"));
        }
        assert!(!codex_run_option_model("gpt-5.4-mini")
            .unwrap()
            .reasoning_efforts
            .contains(&"xhigh"));
    }

    #[test]
    fn json_projection_preserves_catalog_shape_and_order() {
        let value = codex_run_options();
        let models = value["models"].as_array().unwrap();
        assert_eq!(models.len(), CODEX_RUN_OPTION_MODELS.len());
        for (json_model, typed_model) in models.iter().zip(CODEX_RUN_OPTION_MODELS) {
            assert_eq!(json_model["id"], typed_model.id);
            assert_eq!(
                json_model["reasoningEfforts"],
                json!(typed_model.reasoning_efforts)
            );
            assert_eq!(json_model["speedModes"], json!(typed_model.speed_modes));
        }
        assert_eq!(models[0]["id"], "gpt-5.6-sol");
        assert_eq!(models[0]["isDefault"], true);
        assert!(models[1].get("isDefault").is_none());
        assert_eq!(models[6]["note"], "Preview");
    }

    #[test]
    fn selection_validation_uses_the_typed_model_declaration() {
        let explicit =
            validate_codex_run_selection("gpt-5.4", Some("xhigh"), Some("fast")).unwrap();
        assert_eq!(explicit.requested_model, Some("gpt-5.4"));
        assert_eq!(explicit.effort, Some("xhigh"));
        assert_eq!(explicit.service_tier, Some("fast"));

        let managed =
            validate_codex_run_selection("engine-managed", Some("medium"), Some("standard"))
                .unwrap();
        assert_eq!(managed.requested_model, None);
        assert_eq!(managed.effort, Some("medium"));
        assert_eq!(managed.service_tier, None);

        assert!(validate_codex_run_selection("retired-model", None, None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4", Some("extreme"), None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4-mini", Some("xhigh"), None).is_err());
        assert!(validate_codex_run_selection("gpt-5.4", None, Some("turbo")).is_err());
    }
}
