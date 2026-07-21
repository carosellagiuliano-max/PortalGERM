"use client";

import { useActionState } from "react";

import { changeMemberRoleAction, removeMemberAction, resendInvitationAction, revokeInvitationAction } from "@/app/employer/team/actions";
import { assignRecruiterAction, revokeAssignmentAction } from "@/app/employer/team/assignments/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";
import type { getEmployerTeam } from "@/lib/employer/team";

type Team = NonNullable<Awaited<ReturnType<typeof getEmployerTeam>>>;

export function TeamList({ data, canManage }: Readonly<{ data: Team; canManage: boolean }>) {
  const recruiters = data.memberships.filter((member) => member.status === "ACTIVE" && member.role === "RECRUITER");
  return (
    <div className="grid gap-6">
      <Card><CardHeader><CardTitle as="h2">Mitglieder</CardTitle></CardHeader><CardContent className="grid gap-3">{data.memberships.map((member) => <MemberRow key={member.id} member={member} canManage={canManage} />)}</CardContent></Card>
      <Card><CardHeader><CardTitle as="h2">Offene Einladungen</CardTitle></CardHeader><CardContent className="grid gap-3">{data.invitations.length === 0 ? <p className="text-muted-foreground">Keine offenen Einladungen.</p> : data.invitations.map((invite) => <InvitationRow key={invite.id} invite={invite} canManage={canManage} />)}</CardContent></Card>
      <Card><CardHeader><CardTitle as="h2">Job-Zuweisungen</CardTitle></CardHeader><CardContent className="grid gap-4">{canManage ? <AssignmentForm jobs={data.jobs} recruiters={recruiters} /> : <p className="text-muted-foreground">Nur Inhaber:innen und Admins verwalten Zuweisungen.</p>}{data.assignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} canManage={canManage} />)}</CardContent></Card>
    </div>
  );
}

function MemberRow({ member, canManage }: Readonly<{ member: Team["memberships"][number]; canManage: boolean }>) {
  const [roleState, roleAction, rolePending] = useActionState(changeMemberRoleAction, INITIAL_EMPLOYER_ACTION_STATE);
  const [removeState, removeAction, removePending] = useActionState(removeMemberAction, INITIAL_EMPLOYER_ACTION_STATE);
  return <div className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div><p className="font-medium">{member.user.name ?? member.user.email}</p><p className="text-xs text-muted-foreground">{member.user.email} · seit {new Intl.DateTimeFormat("de-CH").format(member.joinedAt)}</p><Badge variant="outline" className="mt-2">{member.status}</Badge></div>{canManage ? <div className="grid gap-2"><form action={roleAction} className="flex flex-wrap gap-2"><input type="hidden" name="membershipId" value={member.id} /><select name="role" defaultValue={member.role} className="h-8 rounded-lg border bg-background px-2 text-sm"><option value="OWNER">Inhaber:in</option><option value="ADMIN">Admin</option><option value="RECRUITER">Recruiter:in</option><option value="VIEWER">Leser:in</option></select><EmployerSubmitButton pending={rolePending} label="Rolle speichern" variant="outline" /></form><EmployerActionFeedback state={roleState} /><form action={removeAction} className="flex flex-wrap gap-2"><input type="hidden" name="membershipId" value={member.id} /><Input name="reason" required minLength={3} maxLength={500} placeholder="Grund der Entfernung" className="min-w-52" /><EmployerSubmitButton pending={removePending} label="Entfernen" variant="destructive" /></form><EmployerActionFeedback state={removeState} /></div> : <Badge>{member.role}</Badge>}</div>;
}

function InvitationRow({ invite, canManage }: Readonly<{ invite: Team["invitations"][number]; canManage: boolean }>) {
  const [resendState, resendAction, resendPending] = useActionState(resendInvitationAction, INITIAL_EMPLOYER_ACTION_STATE);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeInvitationAction, INITIAL_EMPLOYER_ACTION_STATE);
  return <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{invite.inviteeEmailNormalized}</p><p className="text-xs text-muted-foreground">{invite.intendedRole} · Version {invite.tokenVersion} · gültig bis {new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(invite.expiresAt)}</p></div>{canManage ? <div className="grid gap-1"><div className="flex gap-2"><form action={resendAction}><input type="hidden" name="invitationId" value={invite.id} /><EmployerSubmitButton pending={resendPending} label="Neu senden" variant="outline" /></form><form action={revokeAction}><input type="hidden" name="invitationId" value={invite.id} /><EmployerSubmitButton pending={revokePending} label="Widerrufen" variant="destructive" /></form></div><EmployerActionFeedback state={resendState.status !== "idle" ? resendState : revokeState} /></div> : null}</div>;
}

function AssignmentForm({ jobs, recruiters }: Readonly<{ jobs: Team["jobs"]; recruiters: Team["memberships"] }>) {
  const [state, action, pending] = useActionState(assignRecruiterAction, INITIAL_EMPLOYER_ACTION_STATE);
  return <form action={action} className="grid gap-3 rounded-lg bg-muted/40 p-3 md:grid-cols-4 md:items-end"><div className="grid gap-1"><Label htmlFor="assignment-job">Job</Label><select id="assignment-job" name="jobId" required className="h-8 rounded-lg border bg-background px-2 text-sm">{jobs.map((job) => <option key={job.id} value={job.id}>{job.currentRevision?.title ?? "Unbenannt"}</option>)}</select></div><div className="grid gap-1"><Label htmlFor="assignment-recruiter">Recruiter:in</Label><select id="assignment-recruiter" name="membershipId" required className="h-8 rounded-lg border bg-background px-2 text-sm">{recruiters.map((member) => <option key={member.id} value={member.id}>{member.user.name ?? member.user.email}</option>)}</select></div><div className="grid gap-1"><Label htmlFor="assignment-role">Befugnis</Label><select id="assignment-role" name="role" defaultValue="PIPELINE" className="h-8 rounded-lg border bg-background px-2 text-sm"><option value="EDITOR">Editor</option><option value="PIPELINE">Pipeline</option><option value="REVIEWER">Reviewer</option></select></div><div className="grid gap-1"><Label htmlFor="assignment-expiry">Ablauf (optional)</Label><Input id="assignment-expiry" name="expiresAt" type="datetime-local" /></div><div className="md:col-span-4 flex flex-wrap items-center gap-3"><EmployerSubmitButton pending={pending} label="Zuweisung speichern" /><EmployerActionFeedback state={state} /></div></form>;
}

function AssignmentRow({ assignment, canManage }: Readonly<{ assignment: Team["assignments"][number]; canManage: boolean }>) {
  const [state, action, pending] = useActionState(revokeAssignmentAction, INITIAL_EMPLOYER_ACTION_STATE);
  return <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{assignment.job.currentRevision?.title ?? "Unbenannt"}</p><p className="text-xs text-muted-foreground">{assignment.membership.user.name ?? assignment.membership.user.email} · {assignment.role}{assignment.expiresAt ? ` · bis ${new Intl.DateTimeFormat("de-CH").format(assignment.expiresAt)}` : ""}</p></div>{canManage ? <form action={action} className="grid gap-1"><input type="hidden" name="assignmentId" value={assignment.id} /><EmployerSubmitButton pending={pending} label="Entziehen" variant="outline" /><EmployerActionFeedback state={state} /></form> : null}</div>;
}
