import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftsApi, holidaysApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Plus, Edit2, Trash2, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Shift, Holiday } from '@attendance/shared';

type Tab = 'shifts' | 'holidays';

function formatShiftTime(timeStr: string | undefined): string {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  const d = new Date();
  d.setHours(parseInt(parts[0] ?? '0', 10), parseInt(parts[1] ?? '0', 10), 0);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function ShiftsTab(): JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', startTime: '09:00', endTime: '18:00' });
  
  const { data = [], isLoading } = useQuery({ queryKey: ['shifts'], queryFn: shiftsApi.list });

  const saveMutation = useMutation({
    mutationFn: () => editingId ? shiftsApi.update(editingId, form) : shiftsApi.create(form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setOpen(false);
      setForm({ name: '', startTime: '09:00', endTime: '18:00' });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => shiftsApi.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['shifts'] });
      const previous = queryClient.getQueryData<Shift[]>(['shifts']);
      queryClient.setQueryData<Shift[]>(['shifts'], (old) => old?.filter((s) => s.id !== id) ?? []);
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['shifts'], context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['shifts'] }),
  });

  const columns: DataTableColumn<Shift>[] = [
    { key: 'name', header: 'Name', render: (s) => <span className="font-semibold">{s.name}</span> },
    { key: 'startTime', header: 'Start Time', render: (s) => formatShiftTime(s.startTime) },
    { key: 'endTime', header: 'End Time', render: (s) => formatShiftTime(s.endTime) },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div className="flex gap-2">
          <Button size="icon" variant="ghost" onClick={() => {
            setEditingId(s.id);
            setForm({ name: s.name, startTime: s.startTime, endTime: s.endTime });
            setOpen(true);
          }}>
            <Edit2 size={16} />
          </Button>
          <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => {
            if (confirm(`Are you sure you want to delete shift "${s.name}"?`)) {
              deleteMutation.mutate(s.id);
            }
          }}>
            <Trash2 size={16} />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Shifts</h3>
        <Button onClick={() => {
          setEditingId(null);
          setForm({ name: '', startTime: '09:00', endTime: '18:00' });
          setOpen(true);
        }} className="gap-2">
          <Plus size={16} /> Add Shift
        </Button>
      </div>
      <div className="rounded-md border overflow-hidden">
        <DataTable columns={columns} rows={data} getRowKey={(s) => s.id} isLoading={isLoading} />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Edit' : 'Add'} Shift</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="shiftName">Shift Name *</Label>
              <Input id="shiftName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startTime">Start Time *</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time *</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  required
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.name || !form.startTime || !form.endTime || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HolidaysTab(): JSX.Element {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear().toString();
  const [year, setYear] = useState(currentYear);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', date: '' });

  const { data = [], isLoading } = useQuery({ 
    queryKey: ['holidays', year], 
    queryFn: () => holidaysApi.list({ year }) 
  });

  const saveMutation = useMutation({
    mutationFn: () => editingId ? holidaysApi.update(editingId, form) : holidaysApi.create(form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['holidays'] });
      setOpen(false);
      setForm({ name: '', date: '' });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => holidaysApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });

  const columns: DataTableColumn<Holiday>[] = [
    { key: 'name', header: 'Holiday Name', render: (h) => <span className="font-medium">{h.name}</span> },
    { key: 'date', header: 'Date', render: (h) => new Date(h.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
    {
      key: 'actions',
      header: '',
      render: (h) => (
        <div className="flex gap-2">
          <Button size="icon" variant="ghost" onClick={() => {
            setEditingId(h.id);
            setForm({ name: h.name, date: h.date?.split('T')[0] ?? '' });
            setOpen(true);
          }}>
            <Edit2 size={16} />
          </Button>
          <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => {
            if (confirm(`Are you sure you want to delete ${h.name}?`)) {
              deleteMutation.mutate(h.id);
            }
          }}>
            <Trash2 size={16} />
          </Button>
        </div>
      )
    }
  ];

  const yearOptions = Array.from({ length: 5 }, (_, i) => (parseInt(currentYear) - 2 + i).toString());

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Holidays</h3>
        <Button onClick={() => {
          setEditingId(null);
          setForm({ name: '', date: '' });
          setOpen(true);
        }} className="gap-2">
          <Plus size={16} /> Add Holiday
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Label className="flex items-center gap-2 text-muted-foreground">
          <Calendar size={16} /> Filter by Year
        </Label>
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      <div className="rounded-md border overflow-hidden">
        <DataTable columns={columns} rows={data} getRowKey={(h) => h.id} isLoading={isLoading} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Edit' : 'Add'} Holiday</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="holidayName">Name *</Label>
              <Input 
                id="holidayName" 
                value={form.name} 
                onChange={(e) => setForm({ ...form, name: e.target.value })} 
                placeholder="e.g. Christmas, New Year"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="holidayDate">Date *</Label>
              <Input
                id="holidayDate"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.name || !form.date || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OrganizationPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('shifts');

  const tabs = [
    { id: 'shifts', label: 'Shifts', icon: <Clock size={16} /> },
    { id: 'holidays', label: 'Holidays', icon: <Calendar size={16} /> },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Organization</h2>
      </div>

      <div className="flex overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
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
        <CardContent className="p-6">
          {tab === 'shifts' && <ShiftsTab />}
          {tab === 'holidays' && <HolidaysTab />}
        </CardContent>
      </Card>
    </div>
  );
}
