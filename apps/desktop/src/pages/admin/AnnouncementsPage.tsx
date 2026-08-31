import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { announcementsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Megaphone, Plus, Edit2, Trash2, Eye, EyeOff, Calendar, CheckCircle2 } from 'lucide-react';

interface AnnouncementItem {
  id: string;
  message: string;
  isActive: boolean;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function AnnouncementsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ message: '', isActive: true });

  const { data: rawData = [], isLoading } = useQuery<AnnouncementItem[]>({
    queryKey: ['announcements'],
    queryFn: () => announcementsApi.list() as Promise<AnnouncementItem[]>,
  });

  const announcements = rawData || [];

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId
        ? announcementsApi.update(editingId, form)
        : announcementsApi.create(form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setOpen(false);
      setForm({ message: '', isActive: true });
      setEditingId(null);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      announcementsApi.update(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => announcementsApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    setForm({ message: '', isActive: true });
    setOpen(true);
  };

  const handleOpenEdit = (item: AnnouncementItem) => {
    setEditingId(item.id);
    setForm({ message: item.message, isActive: item.isActive });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Megaphone className="w-6 h-6 text-primary" /> Announcements
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Broadcast messages and company-wide notifications to all employees.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2 shadow-sm font-medium">
          <Plus size={16} /> New Announcement
        </Button>
      </div>

      {/* Announcements List */}
      <Card className="border shadow-sm bg-card">
        <CardContent className="p-6">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground animate-pulse">
              Loading announcements...
            </div>
          ) : announcements.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
                <Megaphone size={28} />
              </div>
              <h3 className="text-base font-semibold text-foreground">No announcements found</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-4">
                You haven't posted any announcements yet. Create one to broadcast updates to all employees.
              </p>
              <Button onClick={handleOpenCreate} size="sm" className="gap-1.5">
                <Plus size={14} /> Create First Announcement
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((item) => (
                <div
                  key={item.id}
                  className={`p-5 rounded-xl border transition-all ${
                    item.isActive
                      ? 'bg-card border-border/80 hover:border-border shadow-sm'
                      : 'bg-muted/20 border-border/50 opacity-75'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                        <Calendar size={13} className="text-muted-foreground/70" />
                        {new Date(item.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      {item.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 size={11} /> Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                          <EyeOff size={11} /> Hidden
                        </span>
                      )}
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs gap-1.5"
                        onClick={() =>
                          toggleStatusMutation.mutate({ id: item.id, isActive: !item.isActive })
                        }
                        title={item.isActive ? 'Hide from employees' : 'Publish to employees'}
                      >
                        {item.isActive ? (
                          <>
                            <EyeOff size={13} className="text-muted-foreground" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye size={13} className="text-emerald-600" />
                            <span className="text-emerald-600">Publish</span>
                          </>
                        )}
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => handleOpenEdit(item)}
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this announcement?')) {
                            deleteMutation.mutate(item.id);
                          }
                        }}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  {/* Message Body */}
                  <div className="pt-3.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {item.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden bg-background border rounded-2xl shadow-2xl">
          <DialogHeader className="px-6 py-5 border-b bg-muted/40">
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-primary" />
              {editingId ? 'Edit Announcement' : 'New Announcement'}
            </DialogTitle>
          </DialogHeader>

          <div className="p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="message" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Announcement Message <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Enter your announcement here (e.g. Office will remain closed on Friday due to...)"
                rows={5}
                required
                className="resize-none text-sm leading-relaxed"
              />
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-3 p-3 border rounded-xl bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-xs font-semibold text-foreground block">
                    Publish immediately to employees
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    When checked, this announcement will be visible on employee dashboards.
                  </span>
                </div>
              </label>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!form.message.trim() || saveMutation.isPending}
              className="px-5 font-medium shadow-sm"
            >
              {saveMutation.isPending
                ? 'Saving...'
                : editingId
                ? 'Save Changes'
                : 'Post Announcement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
