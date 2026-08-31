import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api-client';
import { FileDown, Calendar, FileText, Banknote, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'attendance' | 'salary' | 'leave';

const REPORT_CATEGORIES = {
  attendance: [
    { value: 'attendance-daily', label: 'Daily Attendance' },
    { value: 'attendance-monthly', label: 'Monthly Attendance' },
    { value: 'late-arrivals', label: 'Late Arrivals' },
    { value: 'overtime', label: 'Overtime' },
    { value: 'absence', label: 'Absence' },
  ],
  leave: [
    { value: 'leave-summary', label: 'Leave Summary' },
    { value: 'employee-leave-history', label: 'Employee Leave History' },
    { value: 'department-leave', label: 'Department Leave' },
  ],
  salary: [
    { value: 'monthly-salary', label: 'Monthly Salary' },
    { value: 'salary-by-status', label: 'Salary by Status' },
    { value: 'employee-salary-history', label: 'Employee Salary History' },
  ],
};

interface ReportEnvelope {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

export function ReportsPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('attendance');
  const [reportType, setReportType] = useState(REPORT_CATEGORIES.attendance[0]!.value);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', reportType, from, to],
    queryFn: () =>
      apiClient.authenticatedRequest<ReportEnvelope>(
        `/reports/${reportType}?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`,
      ),
  });

  const handleExport = (format: 'xlsx' | 'pdf' | 'csv'): void => {
    const params = new URLSearchParams({ format, ...(from && { from }), ...(to && { to }) });
    window.electronApi.files
      .download(`/reports/${reportType}/export?${params}`, `${reportType}.${format}`)
      .catch(() => undefined);
  };

  const tabs = [
    { id: 'attendance', label: 'Attendance', icon: <Calendar size={16} /> },
    { id: 'salary', label: 'Salary', icon: <Banknote size={16} /> },
    { id: 'leave', label: 'Leave', icon: <FileText size={16} /> },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Reports & Analytics</h2>
      </div>

      <div className="flex overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setReportType(REPORT_CATEGORIES[t.id][0]!.value);
            }}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
              tab === t.id ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="bg-muted/30 pb-4 border-b">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Filter size={18} /> Filters
          </CardTitle>
          <div className="flex flex-wrap items-end gap-4 mt-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Report Type</label>
              <Select value={reportType} onChange={(e) => setReportType(e.target.value)} className="w-56">
                {REPORT_CATEGORIES[tab].map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button onClick={() => refetch()} className="w-full sm:w-auto">Generate Report</Button>
            
            <div className="flex-1"></div>
            
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => handleExport('csv')} className="gap-2" disabled={!data || data.rows.length === 0}>
                <FileDown size={16} /> CSV
              </Button>
              <Button variant="outline" onClick={() => handleExport('xlsx')} className="gap-2" disabled={!data || data.rows.length === 0}>
                <FileDown size={16} /> Excel
              </Button>
              <Button variant="outline" onClick={() => handleExport('pdf')} className="gap-2" disabled={!data || data.rows.length === 0}>
                <FileDown size={16} /> PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {isLoading || !data ? (
              <div className="p-12 text-center text-muted-foreground animate-pulse">
                Generating report data...
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/20">
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.key} className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-r last:border-r-0">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={data.columns.length} className="px-6 py-12 text-center text-muted-foreground">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <FileText size={32} className="opacity-20" />
                          <p>No data found for the selected filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                        {data.columns.map((c) => (
                          <td key={c.key} className="px-6 py-3 border-r last:border-r-0 whitespace-nowrap">
                            {String(row[c.key] ?? '--')}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
