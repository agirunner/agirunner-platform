import type {
  DashboardCommunityCatalogConflictAction,
  DashboardCommunityCatalogImportPreview,
  DashboardCommunityCatalogImportResult,
  DashboardCommunityCatalogPlaybookDetail,
  DashboardCommunityCatalogPlaybookOrigin,
  DashboardCommunityCatalogPlaybookRecord,
} from '../models.js';

export interface DashboardApiMethodsPart4 {
  listCommunityCatalogPlaybooks(): Promise<DashboardCommunityCatalogPlaybookRecord[]>;
  getCommunityCatalogPlaybookDetail(
    playbookId: string,
  ): Promise<DashboardCommunityCatalogPlaybookDetail>;
  previewCommunityCatalogImport(payload: {
    playbook_ids: string[];
  }): Promise<DashboardCommunityCatalogImportPreview>;
  importCommunityCatalogPlaybooks(payload: {
    playbook_ids: string[];
    default_conflict_resolution?: DashboardCommunityCatalogConflictAction;
    conflict_resolutions?: Record<string, DashboardCommunityCatalogConflictAction>;
  }): Promise<DashboardCommunityCatalogImportResult>;
  getCommunityCatalogPlaybookOrigin(
    playbookId: string,
  ): Promise<DashboardCommunityCatalogPlaybookOrigin>;
}
