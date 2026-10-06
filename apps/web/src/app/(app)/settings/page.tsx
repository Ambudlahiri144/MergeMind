import {
  MeResponseSchema,
  UsageResponseSchema,
  type MeResponse,
  type UsageResponse,
} from '@mergemind/shared';
import { WarningIcon as Warning } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';

import { updateBudget } from '@/app/actions/mutations';
import { ActionForm } from '@/components/action-form';
import { ErrorPanel } from '@/components/error-panel';
import { PageHeader } from '@/components/ui/states';
import type { Loaded } from '@/lib/load';
import { compactTokens } from '@/lib/format';
import { load } from '@/lib/load';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Settings' };

/** Design.md §3 usage line: text, not a chart. */
function UsageLine({ usage }: { usage: UsageResponse }) {
  const percent =
    usage.monthlyTokenBudget === 0
      ? 100
      : Math.floor((usage.usedTokens / usage.monthlyTokenBudget) * 100);
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span>
        <span className="font-mono text-[13px]">{compactTokens(usage.usedTokens)}</span> of{' '}
        <span className="font-mono text-[13px]">{compactTokens(usage.monthlyTokenBudget)}</span>{' '}
        tokens used this month ({percent}%)
      </span>
      {usage.state === 'ok' ? null : (
        <span className="inline-flex items-center gap-1 rounded-full bg-sev-major-bg px-2 py-0.5 text-xs font-medium tracking-[0.04em] text-sev-major uppercase">
          <Warning size={14} weight="bold" aria-hidden="true" />
          {usage.state === 'warn' ? 'Near budget' : 'Budget used up'}
        </span>
      )}
    </p>
  );
}

function InstallationSettings({
  installation,
  usage,
}: {
  installation: MeResponse['installations'][number];
  usage: Loaded<UsageResponse>;
}) {
  const canEdit = installation.role !== 'member';
  const fieldId = `budget-${installation.id}`;
  return (
    <section
      aria-labelledby={`settings-${installation.id}`}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id={`settings-${installation.id}`} className="text-lg leading-7 font-semibold">
        {installation.accountLogin}
        <span className="ml-2 text-sm font-normal text-text-muted">
          {installation.status} · your role: {installation.role}
        </span>
      </h2>
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="font-medium">Usage</dt>
        <dd>
          {usage.ok ? <UsageLine usage={usage.data} /> : <ErrorPanel problem={usage.problem} />}
        </dd>
        <dt className="font-medium">AI providers for private code</dt>
        <dd className="text-text-muted">
          {installation.allowedProviders.join(', ')}. Public repositories may also use Gemini. Read
          only for now.
        </dd>
        <dt className="font-medium">Monthly token budget</dt>
        <dd>
          {canEdit && usage.ok ? (
            <ActionForm
              action={updateBudget}
              fields={{ installationId: installation.id }}
              label="Save budget"
              pendingLabel="Saving"
              variant="primary"
            >
              <label htmlFor={fieldId} className="font-medium">
                Tokens per month
              </label>
              <span id={`${fieldId}-help`} className="text-xs text-text-muted">
                Reviews pause with a neutral check when this is used up.
              </span>
              <input
                id={fieldId}
                name="monthlyTokenBudget"
                inputMode="numeric"
                defaultValue={String(usage.data.monthlyTokenBudget)}
                aria-describedby={`${fieldId}-help`}
                className="h-9 w-48 rounded-md border border-border bg-surface px-3 font-mono text-[13px]"
              />
            </ActionForm>
          ) : (
            <span className="text-text-muted">
              {usage.ok ? compactTokens(usage.data.monthlyTokenBudget) : 'Unknown'}. Only admins can
              change it.
            </span>
          )}
        </dd>
      </dl>
    </section>
  );
}

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const me = await load(viewer, '/me', MeResponseSchema);
  if (!me.ok) {
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorPanel problem={me.problem} />
      </>
    );
  }
  const installations = await Promise.all(
    me.data.installations.map(async (installation) => ({
      installation,
      usage: await load(viewer, `/installations/${installation.id}/usage`, UsageResponseSchema),
    })),
  );
  return (
    <>
      <PageHeader title="Settings" meta={`Signed in as ${me.data.user.login}`} />
      <div className="flex flex-col gap-4">
        {installations.map(({ installation, usage }) => (
          <InstallationSettings key={installation.id} installation={installation} usage={usage} />
        ))}
      </div>
    </>
  );
}
