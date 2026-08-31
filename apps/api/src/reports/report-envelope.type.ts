export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportEnvelope {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}
