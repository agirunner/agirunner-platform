package manager

// DCM container labels identify containers managed by the Dynamic Container Manager.
const (
	labelDCMManaged    = "agirunner.managed"
	labelDCMTier       = "agirunner.tier"
	labelDCMTemplateID = "agirunner.template_id"
	labelDCMRuntimeID  = "agirunner.runtime_id"
	labelDCMImage      = "agirunner.image"
	labelDCMDraining   = "agirunner.draining"
)

// DCM tier values distinguish runtime containers from task containers.
const (
	tierRuntime = "runtime"
	tierTask    = "task"
)
