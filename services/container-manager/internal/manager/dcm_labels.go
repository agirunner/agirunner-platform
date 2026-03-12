package manager

// DCM container labels identify containers managed by the Dynamic Container Manager.
const (
	labelDCMManaged      = "agirunner.managed"
	labelDCMTier         = "agirunner.tier"
	labelDCMPlaybookID   = "agirunner.playbook_id"
	labelDCMRuntimeID    = "agirunner.runtime_id"
	labelDCMImage        = "agirunner.image"
	labelDCMDraining     = "agirunner.draining"
	labelDCMPoolKind     = "agirunner.pool_kind"
	labelDCMGracePeriod  = "agirunner.grace_period"
	labelDCMPlaybookName = "com.agirunner.dcm.playbook-name"
	labelDCMPoolMode     = "agirunner.pool_mode"
	labelDCMPriority     = "agirunner.priority"
)

// DCM tier values distinguish runtime containers from task containers.
const (
	tierRuntime = "runtime"
	tierTask    = "task"
)
