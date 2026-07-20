use super::persistence::{
    host_error_message, validate_evaluation_lease_claim, validate_task_workspace_claim,
};
use super::*;

impl ProjectWorkspaceSelectionRegistry {
    pub(super) fn register(
        &self,
        window_label: &str,
        canonical_root: PathBuf,
        now: i64,
    ) -> Result<ProjectWorkspaceSelectionClaim, String> {
        let root_identity = root_identity(&canonical_root)?;
        let display_path = canonical_root_text(&canonical_root).map_err(host_error_message)?;
        let selection_ref = random_ref();
        let expires_at_unix_ms = now.saturating_add(PROJECT_WORKSPACE_SELECTION_TTL_MS);
        let mut selections = self
            .selections
            .lock()
            .map_err(|_| "Project workspace selection registry is unavailable.".to_string())?;
        selections.retain(|_, selection| selection.expires_at_unix_ms >= now);
        selections.insert(
            selection_ref.clone(),
            ProjectWorkspaceSelection {
                canonical_root,
                root_identity,
                window_label: window_label.to_string(),
                expires_at_unix_ms,
            },
        );
        Ok(ProjectWorkspaceSelectionClaim {
            selection_ref,
            display_path,
            expires_at_unix_ms,
        })
    }

    pub(super) fn consume(
        &self,
        selection_ref: &str,
        window_label: &str,
        now: i64,
    ) -> Result<ProjectWorkspaceSelection, String> {
        let mut selections = self
            .selections
            .lock()
            .map_err(|_| "Project workspace selection registry is unavailable.".to_string())?;
        let selection = selections.remove(selection_ref).ok_or_else(|| {
            "Project folder selection is invalid, expired, or already used. Choose the folder again."
                .to_string()
        })?;
        if selection.window_label != window_label {
            return Err(
                "Project folder selection belongs to another window. Choose the folder again."
                    .into(),
            );
        }
        if selection.expires_at_unix_ms < now {
            return Err("Project folder selection expired. Choose the folder again.".into());
        }
        let live_identity = root_identity(&selection.canonical_root)?;
        if live_identity != selection.root_identity {
            return Err(
                "The selected Project folder changed before it could be saved. Choose it again."
                    .into(),
            );
        }
        Ok(selection)
    }
}

impl TaskWorkspaceBindingRegistry {
    pub(super) fn insert(&self, binding: TaskWorkspaceBinding, now: i64) -> Result<(), HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        active.retain(|_, entry| {
            if entry.revoked_at_unix_ms.is_some() {
                entry
                    .read_grace_until_unix_ms
                    .map(|until| until >= now)
                    .unwrap_or(false)
            } else {
                entry
                    .binding
                    .expires_at_unix_ms
                    .saturating_add(REVOKED_READ_GRACE_MS)
                    >= now
            }
        });
        active.insert(
            binding.binding_ref.clone(),
            ActiveBinding {
                binding,
                revoked_at_unix_ms: None,
                read_grace_until_unix_ms: None,
                revocation_reason: None,
            },
        );
        Ok(())
    }

    pub(super) fn remove_unpublished(&self, binding_ref: &str) -> Result<(), HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        active.remove(binding_ref);
        Ok(())
    }

    pub(super) fn live_binding_ids(&self, now: i64) -> Result<HashSet<String>, HostError> {
        let active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        Ok(active
            .values()
            .filter(|entry| {
                entry.revoked_at_unix_ms.is_none()
                    && entry.binding.expires_at_unix_ms > now
                    && root_identity(&entry.binding.canonical_root)
                        .is_ok_and(|identity| identity == entry.binding.root_identity)
            })
            .map(|entry| entry.binding.binding_id.clone())
            .collect())
    }

    pub(super) fn resolve_at(
        &self,
        binding_ref: &str,
        scope: &IssueTaskWorkspaceBinding<'_>,
        now: i64,
    ) -> Result<TaskWorkspaceBinding, ResolveBindingError> {
        let active = self.active.lock().map_err(|_| {
            ResolveBindingError::Registry("Task workspace registry lock is poisoned.".into())
        })?;
        let Some(entry) = active.get(binding_ref) else {
            return Err(ResolveBindingError::Invalid);
        };
        if entry.binding.company_id != scope.company_id
            || entry.binding.project_id != scope.project_id
            || entry.binding.thread_id != scope.thread_id
            || entry.binding.turn_id != scope.turn_id
            || entry.binding.request_id != scope.request_id
        {
            return Err(ResolveBindingError::Scope);
        }
        if !entry.binding.access.permits(scope.access) {
            return Err(ResolveBindingError::Access);
        }
        if entry.revoked_at_unix_ms.is_some() {
            if !scope.access.permitted_during_terminal_grace()
                || entry
                    .read_grace_until_unix_ms
                    .map(|until| until < now)
                    .unwrap_or(true)
            {
                return Err(
                    if entry.revocation_reason == Some(TaskWorkspaceAuthorityLossReason::Expired) {
                        ResolveBindingError::Expired
                    } else {
                        ResolveBindingError::Revoked
                    },
                );
            }
        } else if entry.binding.expires_at_unix_ms <= now {
            return Err(ResolveBindingError::Expired);
        }
        if root_identity(&entry.binding.canonical_root)
            .map_err(|_| ResolveBindingError::RootChanged)?
            != entry.binding.root_identity
        {
            return Err(ResolveBindingError::RootChanged);
        }
        Ok(entry.binding.clone())
    }

    pub(super) fn validate_authority_at(
        &self,
        binding_ref: &str,
        scope: &IssueTaskWorkspaceBinding<'_>,
        now: i64,
    ) -> Result<(), ResolveBindingError> {
        self.resolve_at(binding_ref, scope, now).map(|_| ())
    }

    pub(super) fn transition_revocation(
        &self,
        binding_ref: &str,
        now: i64,
        reason: TaskWorkspaceAuthorityLossReason,
    ) -> Result<RegistryRevocation, HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        let entry = active.get_mut(binding_ref).ok_or_else(|| {
            HostError::Request("Task workspace binding is no longer active.".into())
        })?;
        if let (Some(revoked_at), Some(grace_until), Some(existing_reason)) = (
            entry.revoked_at_unix_ms,
            entry.read_grace_until_unix_ms,
            entry.revocation_reason,
        ) {
            return Ok(RegistryRevocation {
                binding_id: entry.binding.binding_id.clone(),
                revoked_at_unix_ms: revoked_at,
                grace_until_unix_ms: grace_until,
                reason: existing_reason,
            });
        }
        let grace_until = now.saturating_add(REVOKED_READ_GRACE_MS);
        entry.revoked_at_unix_ms = Some(now);
        entry.read_grace_until_unix_ms = Some(grace_until);
        entry.revocation_reason = Some(reason);
        Ok(RegistryRevocation {
            binding_id: entry.binding.binding_id.clone(),
            revoked_at_unix_ms: now,
            grace_until_unix_ms: grace_until,
            reason,
        })
    }

    pub(super) fn revoke(
        &self,
        binding_ref: &str,
        now: i64,
    ) -> Result<RegistryRevocation, HostError> {
        self.transition_revocation(binding_ref, now, TaskWorkspaceAuthorityLossReason::Revoked)
    }

    pub(super) fn expire(
        &self,
        binding_ref: &str,
        now: i64,
    ) -> Result<RegistryRevocation, HostError> {
        self.transition_revocation(binding_ref, now, TaskWorkspaceAuthorityLossReason::Expired)
    }

    pub(super) fn replayable_for_request_at(
        &self,
        request_id: &str,
        now: i64,
    ) -> Result<Option<TaskWorkspaceBinding>, HostError> {
        let active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        let binding = active
            .values()
            .filter(|entry| {
                entry.binding.request_id == request_id
                    && if entry.revoked_at_unix_ms.is_some() {
                        entry
                            .read_grace_until_unix_ms
                            .map(|until| until >= now)
                            .unwrap_or(false)
                    } else {
                        entry.binding.expires_at_unix_ms > now
                    }
            })
            .max_by_key(|entry| entry.binding.issued_at_unix_ms)
            .map(|entry| entry.binding.clone());
        match binding {
            Some(binding)
                if root_identity(&binding.canonical_root)
                    .map(|identity| identity == binding.root_identity)
                    .unwrap_or(false) =>
            {
                Ok(Some(binding))
            }
            Some(_) => Err(HostError::Request(
                "Task workspace root identity changed after binding.".into(),
            )),
            None => Ok(None),
        }
    }

    pub(super) fn resolve_evaluation_binding_at(
        &self,
        binding_claim: &TaskWorkspaceBindingClaim,
        now: i64,
    ) -> Result<TaskWorkspaceBinding, String> {
        let scope = IssueTaskWorkspaceBinding {
            company_id: &binding_claim.company_id,
            project_id: &binding_claim.project_id,
            thread_id: &binding_claim.thread_id,
            turn_id: &binding_claim.turn_id,
            request_id: &binding_claim.request_id,
            access: TaskWorkspaceAccess::Read,
        };
        let binding = self
            .resolve_at(&binding_claim.workspace_ref, &scope, now)
            .map_err(|error| host_error_message(error.into_host_error()))?;
        validate_task_workspace_claim(&binding, binding_claim, None)?;
        if binding.access != TaskWorkspaceAccess::Write {
            return Err(
                "Mission evaluation requires an original write-capable workspace binding.".into(),
            );
        }
        Ok(binding)
    }

    pub(super) fn acquire_evaluation_lease_at(
        &self,
        binding: TaskWorkspaceBinding,
        verified: VerifiedEvaluationScope,
        now: i64,
    ) -> Result<TaskWorkspaceEvaluationLeaseClaim, String> {
        let mut leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        if let Some(existing) = leases.values().find(|lease| {
            lease.claim.history_id == binding.binding_id
                && lease.claim.mission_id == verified.mission_id
                && lease.claim.attempt_id == verified.attempt_id
        }) {
            if !existing.released && now < existing.claim.expires_at_unix_ms {
                return Ok(existing.claim.clone());
            }
            return Err(
                "Task workspace evaluation lease already ended and cannot be renewed.".into(),
            );
        }

        let claim = TaskWorkspaceEvaluationLeaseClaim {
            evaluation_lease_ref: random_ref(),
            history_id: binding.binding_id.clone(),
            company_id: binding.company_id.clone(),
            project_id: binding.project_id.clone(),
            thread_id: binding.thread_id.clone(),
            turn_id: binding.turn_id.clone(),
            request_id: binding.request_id.clone(),
            mission_id: verified.mission_id,
            attempt_id: verified.attempt_id,
            issued_at_unix_ms: now,
            expires_at_unix_ms: now.saturating_add(EVALUATION_LEASE_TTL_MS),
        };
        leases.insert(
            claim.evaluation_lease_ref.clone(),
            EvaluationLease {
                claim: claim.clone(),
                canonical_root: binding.canonical_root,
                root_identity: binding.root_identity,
                released: false,
            },
        );
        Ok(claim)
    }

    pub(super) fn resolve_evaluation_lease_at(
        &self,
        claim: &TaskWorkspaceEvaluationLeaseClaim,
        catalog_project_id: Option<&str>,
        requested_access: TaskWorkspaceAccess,
        now: i64,
    ) -> Result<EvaluationLease, String> {
        if !matches!(
            requested_access,
            TaskWorkspaceAccess::Read | TaskWorkspaceAccess::Verify
        ) {
            return Err(
                "Task workspace evaluation lease never grants direct project write access.".into(),
            );
        }
        let leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        let lease = leases
            .get(&claim.evaluation_lease_ref)
            .ok_or_else(|| "Task workspace evaluation lease is invalid.".to_string())?;
        validate_evaluation_lease_claim(lease, claim, catalog_project_id)?;
        if lease.released {
            return Err("Task workspace evaluation lease has been released.".into());
        }
        if now >= lease.claim.expires_at_unix_ms {
            return Err("Task workspace evaluation lease has expired.".into());
        }
        if root_identity(&lease.canonical_root)? != lease.root_identity {
            return Err(
                "Task workspace evaluation root identity changed after lease issue.".into(),
            );
        }
        Ok(lease.clone())
    }

    pub(super) fn invalidate_evaluation_lease(&self, evaluation_lease_ref: &str) {
        if let Ok(mut leases) = self.evaluation_leases.lock() {
            if let Some(lease) = leases.get_mut(evaluation_lease_ref) {
                lease.released = true;
            }
        }
    }

    pub(super) fn release_evaluation_lease_at(
        &self,
        claim: &TaskWorkspaceEvaluationLeaseClaim,
        now: i64,
    ) -> Result<(), String> {
        let mut leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        let lease = leases
            .get_mut(&claim.evaluation_lease_ref)
            .ok_or_else(|| "Task workspace evaluation lease is invalid.".to_string())?;
        validate_evaluation_lease_claim(lease, claim, None)?;
        if lease.released || now >= lease.claim.expires_at_unix_ms {
            return Ok(());
        }
        lease.released = true;
        Ok(())
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(in super::super) fn fixture_binding(
        root: &Path,
        access: TaskWorkspaceAccess,
    ) -> TaskWorkspaceBinding {
        let evidence =
            crate::workspace_recovery::capture_workspace_evidence(root, "Project").unwrap();
        let root_identity = root_identity(root).expect("fixture root identity");
        let authority_snapshot_root_identity_json =
            serde_json::to_string(&root_identity).expect("fixture identity json");
        TaskWorkspaceBinding {
            binding_ref: random_ref(),
            binding_id: random_id(),
            company_id: "company-1".into(),
            project_id: "project-1".into(),
            thread_id: "thread-1".into(),
            turn_id: "turn-1".into(),
            request_id: "request-1".into(),
            access,
            canonical_root: root.to_path_buf(),
            root_identity,
            workspace_basename_normalized: evidence.basename_normalized,
            project_name_normalized: evidence.project_name_normalized,
            workspace_anchor: evidence.anchor,
            git_origin_digest: evidence.git_origin_digest,
            recovery_witness_binding_id: None,
            recovery_witness_authority_project_id: None,
            authority_snapshot_canonical_root: root.to_string_lossy().into_owned(),
            authority_snapshot_root_identity_json,
            authority_snapshot_updated_at_unix_ms: 1_000,
            source: WorkspaceRecoverySource::ProjectCatalog,
            confidence: 1.0,
            reason_code: WorkspaceRecoveryReason::CurrentProjectFolder,
            issued_at_unix_ms: 1_000,
            expires_at_unix_ms: 100_000_000,
            project_verify_command: Some("pnpm typecheck".into()),
            project_verify_max_attempts: 3,
            project_verify_token_budget: Some(12_000),
        }
    }

    pub(in super::super) fn scope<'a>(
        access: TaskWorkspaceAccess,
    ) -> IssueTaskWorkspaceBinding<'a> {
        IssueTaskWorkspaceBinding {
            company_id: "company-1",
            project_id: "project-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_id: "request-1",
            access,
        }
    }

    pub(in super::super) fn claim(binding: &TaskWorkspaceBinding) -> TaskWorkspaceBindingClaim {
        TaskWorkspaceBindingClaim {
            workspace_ref: binding.binding_ref.clone(),
            history_id: binding.binding_id.clone(),
            company_id: binding.company_id.clone(),
            project_id: binding.project_id.clone(),
            thread_id: binding.thread_id.clone(),
            turn_id: binding.turn_id.clone(),
            request_id: binding.request_id.clone(),
            access: binding.access.as_str().into(),
        }
    }

    #[test]
    fn opaque_refs_are_256_bit_urlsafe_capabilities() {
        let first = random_ref();
        let second = random_ref();
        assert_ne!(first, second);
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(first)
                .expect("decode binding ref")
                .len(),
            32
        );
    }

    #[test]
    fn registry_enforces_scope_access_expiry_and_revoked_read_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                2_000
            )
            .is_ok());
        let wrong_scope = IssueTaskWorkspaceBinding {
            project_id: "project-2",
            ..scope(TaskWorkspaceAccess::Read)
        };
        assert!(matches!(
            registry.resolve_at(&binding.binding_ref, &wrong_scope, 2_000),
            Err(ResolveBindingError::Scope)
        ));
        let revocation = registry
            .revoke(&binding.binding_ref, 3_000)
            .expect("revoke binding");
        let grace_until = revocation.grace_until_unix_ms;
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                3_001
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                3_001
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));

        let mut expired = fixture_binding(&root, TaskWorkspaceAccess::Read);
        expired.expires_at_unix_ms = 10_000;
        registry
            .insert(expired.clone(), 1_000)
            .expect("insert expired");
        assert!(matches!(
            registry.resolve_at(
                &expired.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                10_000
            ),
            Err(ResolveBindingError::Expired)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn revoked_read_grace_covers_terminal_stream_replay_window() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        let revoked_at = 3_000;
        let revocation = registry
            .revoke(&binding.binding_ref, revoked_at)
            .expect("revoke binding");
        let grace_until = revocation.grace_until_unix_ms;
        assert_eq!(grace_until - revoked_at, REVOKED_READ_GRACE_MS);
        assert_eq!(
            REVOKED_READ_GRACE_MS,
            crate::pi_agent_host::PI_RUN_STREAM_TERMINAL_TTL_SECS as i64 * 1_000
        );
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                revoked_at + 6 * 60 * 1_000
            )
            .is_ok());
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn binding_expiry_transition_is_idempotent_and_preserves_read_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let mut binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        binding.expires_at_unix_ms = 5_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                5_000
            ),
            Err(ResolveBindingError::Expired)
        ));
        let first = registry
            .expire(&binding.binding_ref, 5_000)
            .expect("transition expiry");
        let repeated = registry
            .expire(&binding.binding_ref, 9_000)
            .expect("repeat expiry transition");
        assert_eq!(first.revoked_at_unix_ms, repeated.revoked_at_unix_ms);
        assert_eq!(first.grace_until_unix_ms, repeated.grace_until_unix_ms);
        assert_eq!(
            first.grace_until_unix_ms,
            first.revoked_at_unix_ms + REVOKED_READ_GRACE_MS
        );
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                first.grace_until_unix_ms
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                first.grace_until_unix_ms
            ),
            Err(ResolveBindingError::Expired)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                first.grace_until_unix_ms + 1
            ),
            Err(ResolveBindingError::Expired)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn read_binding_never_authorizes_write() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Read);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                2_000
            ),
            Err(ResolveBindingError::Access)
        ));
        assert!(registry
            .resolve_evaluation_binding_at(&claim(&binding), 2_000)
            .is_err());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn read_binding_never_authorizes_verification() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Read);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                2_000
            ),
            Err(ResolveBindingError::Access)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn revoked_write_binding_allows_only_read_for_full_terminal_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let mut binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        binding.expires_at_unix_ms = 10_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        let terminal_at = binding.expires_at_unix_ms - 1;
        let revocation = registry
            .revoke(&binding.binding_ref, terminal_at)
            .expect("revoke binding immediately before original expiry");
        let grace_until = revocation.grace_until_unix_ms;
        assert_eq!(grace_until, terminal_at + REVOKED_READ_GRACE_MS);

        // A later insert runs registry retention after the original expiry.
        // The terminal binding must remain live until its independent grace end.
        let mut unrelated = fixture_binding(&root, TaskWorkspaceAccess::Read);
        unrelated.request_id = "request-2".into();
        registry
            .insert(unrelated, binding.expires_at_unix_ms + 1)
            .expect("retain terminal binding past original expiry");

        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                binding.expires_at_unix_ms
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                binding.expires_at_unix_ms
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(registry
            .replayable_for_request_at(&binding.request_id, grace_until)
            .expect("replay terminal binding")
            .is_some());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(registry
            .replayable_for_request_at(&binding.request_id, grace_until + 1)
            .expect("expire terminal replay grace")
            .is_none());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn evaluation_lease_is_bounded_nonrenewable_and_never_direct_write() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        let binding_claim = claim(&binding);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        registry
            .revoke(&binding.binding_ref, 2_000)
            .expect("terminalize source binding");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                2_001
            ),
            Err(ResolveBindingError::Revoked)
        ));
        let source = registry
            .resolve_evaluation_binding_at(&binding_claim, 2_001)
            .expect("terminal read grace may prove the original write grant");
        let lease = registry
            .acquire_evaluation_lease_at(
                source,
                VerifiedEvaluationScope {
                    mission_id: "mission-1".into(),
                    attempt_id: "attempt-1".into(),
                },
                2_001,
            )
            .expect("acquire evaluation lease");

        for operation in [TaskWorkspaceAccess::Read, TaskWorkspaceAccess::Verify] {
            assert!(registry
                .resolve_evaluation_lease_at(&lease, Some("project-1"), operation, 2_002)
                .is_ok());
        }
        assert!(registry
            .resolve_evaluation_lease_at(
                &lease,
                Some("project-1"),
                TaskWorkspaceAccess::Write,
                2_002
            )
            .is_err());

        let mut forged_attempt = lease.clone();
        forged_attempt.attempt_id = "attempt-2".into();
        assert!(registry
            .resolve_evaluation_lease_at(
                &forged_attempt,
                Some("project-1"),
                TaskWorkspaceAccess::Read,
                2_002
            )
            .is_err());

        registry
            .release_evaluation_lease_at(&lease, 2_003)
            .expect("release evaluation lease");
        registry
            .release_evaluation_lease_at(&lease, 2_004)
            .expect("repeat release is idempotent");
        assert!(registry
            .resolve_evaluation_lease_at(
                &lease,
                Some("project-1"),
                TaskWorkspaceAccess::Verify,
                2_004
            )
            .is_err());
        assert!(registry
            .acquire_evaluation_lease_at(
                binding,
                VerifiedEvaluationScope {
                    mission_id: "mission-1".into(),
                    attempt_id: "attempt-1".into(),
                },
                2_005,
            )
            .is_err());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn evaluation_lifecycle_separates_running_acquire_from_verifying_use() {
        assert!(validate_evaluation_lifecycle_status(
            "running",
            "running",
            false,
            EvaluationScopePhase::Acquire,
        )
        .is_ok());
        assert!(validate_evaluation_lifecycle_status(
            "verifying",
            "running",
            false,
            EvaluationScopePhase::Use,
        )
        .is_ok());
        assert!(validate_evaluation_lifecycle_status(
            "running",
            "running",
            false,
            EvaluationScopePhase::Use,
        )
        .is_err());
        assert!(validate_evaluation_lifecycle_status(
            "completed",
            "pass",
            true,
            EvaluationScopePhase::Use,
        )
        .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn authorized_process_cwd_rejects_root_replacement_after_command_binding() {
        let fixture = std::env::temp_dir().join(format!("offisim-process-root-{}", random_id()));
        let root = fixture.join("root");
        let original = fixture.join("original");
        std::fs::create_dir_all(&root).expect("create process root fixture");
        let root = root.canonicalize().expect("canonical process root");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture process root authority");
        let execution = AuthorizedProcessCwd::from_authority(&authority, &root)
            .expect("capture process cwd authority");
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args(["-c", "printf replacement > replacement-sentinel"]);
        execution
            .bind_command(&mut command)
            .expect("bind process command before replacement");

        std::fs::rename(&root, &original).expect("move original process root");
        std::fs::create_dir(&root).expect("create same-path replacement root");
        let result = command.output().await;

        assert!(
            result.is_err(),
            "root replacement must fail the child pre-exec"
        );
        assert!(
            !root.join("replacement-sentinel").exists(),
            "replacement root must remain untouched"
        );
        assert!(
            !original.join("replacement-sentinel").exists(),
            "failed spawn must not write through the captured descriptor"
        );
        std::fs::remove_dir_all(fixture).expect("remove process root fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn authorized_process_cwd_rejects_moved_nested_cwd_symlink_backfill() {
        let fixture = std::env::temp_dir().join(format!("offisim-process-nested-{}", random_id()));
        let root = fixture.join("root");
        let nested = root.join("nested");
        let moved = fixture.join("moved-nested");
        std::fs::create_dir_all(&nested).expect("create nested process cwd fixture");
        let root = root.canonicalize().expect("canonical process root");
        let nested = nested.canonicalize().expect("canonical nested process cwd");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture nested root authority");
        let execution = AuthorizedProcessCwd::from_authority(&authority, &nested)
            .expect("capture nested cwd authority");
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args(["-c", "printf escaped > outside-sentinel"]);
        execution
            .bind_command(&mut command)
            .expect("bind nested process command before replacement");

        std::fs::rename(&nested, &moved).expect("move nested cwd outside the root");
        std::os::unix::fs::symlink(&moved, &nested)
            .expect("backfill nested cwd with same-inode symlink");
        let result = command.output().await;

        assert!(
            result.is_err(),
            "same-inode symlink backfill must fail the descriptor rewalk"
        );
        assert!(
            !moved.join("outside-sentinel").exists(),
            "moved cwd outside the root must remain untouched"
        );
        std::fs::remove_file(&nested).expect("remove nested cwd symlink");
        std::fs::remove_dir_all(fixture).expect("remove nested process fixture");
    }

    #[cfg(unix)]
    #[test]
    fn authorized_process_cwd_from_expected_rejects_a_preexisting_replacement() {
        use std::os::unix::fs::MetadataExt;

        let fixture =
            std::env::temp_dir().join(format!("offisim-process-expected-{}", random_id()));
        let root = fixture.join("root");
        let cwd = root.join("worktree");
        let original = fixture.join("original-worktree");
        std::fs::create_dir_all(&cwd).expect("create expected process cwd fixture");
        let root = root
            .canonicalize()
            .expect("canonical expected process root");
        let cwd = cwd.canonicalize().expect("canonical expected process cwd");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root)
            .expect("capture expected process root authority");
        let durable = cwd.metadata().expect("inspect durable process cwd");

        std::fs::rename(&cwd, &original).expect("move durable process cwd");
        std::fs::create_dir(&cwd).expect("create same-path process cwd replacement");
        let result =
            AuthorizedProcessCwd::from_expected(&authority, &cwd, durable.dev(), durable.ino());

        assert!(
            result.is_err(),
            "durable identity construction must reject an already replaced cwd"
        );
        std::fs::remove_dir_all(fixture).expect("remove expected process fixture");
    }

    #[test]
    fn registry_rejects_replaced_root_identity() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        std::fs::remove_dir(&root).expect("remove original fixture root");
        std::fs::create_dir(&root).expect("replace fixture root");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                2_000
            ),
            Err(ResolveBindingError::RootChanged)
        ));
        std::fs::remove_dir(root).expect("remove replacement fixture root");
    }
}
