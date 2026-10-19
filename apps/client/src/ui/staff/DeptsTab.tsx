import { useCallback, useEffect, useState } from 'react';
import { DEPT_PALETTE, MAX_DEPT_NAME, badgeTextColor, isGeneralDept } from '@workverse/shared';
import { Field, usePanel } from './staffUi';
import { staffApi, type OrgChoice } from './staffApi';

/** Setores de cada organização: nome + cor da paleta. A cor aparece na etiqueta de cargo sobre o avatar e no crachá. */
export function DeptsTab() {
  const p = usePanel();
  const [orgs, setOrgs] = useState<OrgChoice[]>([]);
  const [orgId, setOrgId] = useState('default');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(DEPT_PALETTE[0]!.color);
  const { run } = p;
  const canManage = p.can('dept.manage');

  const load = useCallback(async () => {
    const o = await run(() => staffApi.orgs());
    if (o) setOrgs(o);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const add = async () => {
    if (!org) return;
    if (await run(() => staffApi.createDept(org.id, name.trim(), color), 'Setor criado.')) {
      setName('');
      void load();
    }
  };

  return (
    <div data-testid="staff-tab-depts">
      <Field label="Organização">
        <select className="sf-input sf-select" value={org?.id ?? ''} onChange={(e) => setOrgId(e.target.value)} data-testid="staff-depts-org">
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
      <ul className="sf-list" data-testid="staff-depts-list">
        {org?.teams.map((t) => (
          <DeptRow key={t.id} orgId={org.id} dept={t} canManage={canManage} onSaved={() => void load()} />
        ))}
      </ul>
      <form
        className="sf-card"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h3 className="sf-card-title">Novo setor</h3>
        <Field label="Nome" hint={`2 a ${MAX_DEPT_NAME} caracteres (ex.: Financeiro, TI, RH, Comercial)`}>
          <input className="sf-input" value={name} maxLength={MAX_DEPT_NAME} onChange={(e) => setName(e.target.value)} data-testid="staff-dept-new-name" />
        </Field>
        <Swatches value={color} onChange={setColor} />
        <button className="mini gold" disabled={!canManage || name.trim().length < 2} data-testid="staff-dept-new-submit">
          Criar setor
        </button>
      </form>
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange(c: string): void }) {
  return (
    <div className="sf-swatches" role="radiogroup" aria-label="Cor do setor">
      {DEPT_PALETTE.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c.color}
          title={c.name}
          className={`sf-swatch ${value.toLowerCase() === c.color ? 'on' : ''}`}
          style={{ background: c.color, color: badgeTextColor(c.color) }}
          onClick={() => onChange(c.color)}
          data-testid={`swatch-${c.id}`}
        >
          {value.toLowerCase() === c.color ? '✓' : ''}
        </button>
      ))}
    </div>
  );
}

function DeptRow({ orgId, dept, canManage, onSaved }: { orgId: string; dept: { id: string; name: string; color: string }; canManage: boolean; onSaved(): void }) {
  const p = usePanel();
  const [name, setName] = useState(dept.name);
  const [color, setColor] = useState(dept.color);
  const general = isGeneralDept(dept);
  const changed = name.trim() !== dept.name || color.toLowerCase() !== dept.color.toLowerCase();
  const save = async () => {
    const body: { name?: string; color?: string } = {};
    if (name.trim() !== dept.name) body.name = name.trim();
    if (color.toLowerCase() !== dept.color.toLowerCase()) body.color = color;
    if (await p.run(() => staffApi.updateDept(orgId, dept.id, body), 'Setor atualizado. Quem está online já vê a mudança.')) onSaved();
  };
  return (
    <li className="sf-card" data-testid={`staff-dept-${dept.name}`}>
      <div className="sf-grid2">
        <Field label={general ? 'Equipe padrão (sem etiqueta)' : 'Nome'}>
          <input className="sf-input" value={name} maxLength={MAX_DEPT_NAME} onChange={(e) => setName(e.target.value)} disabled={!canManage || general} aria-label={`Nome do setor ${dept.name}`} />
        </Field>
        {!general && <Swatches value={color} onChange={setColor} />}
      </div>
      {!general && (
        <button type="button" className="mini gold" disabled={!canManage || !changed || name.trim().length < 2} onClick={() => void save()} data-testid={`staff-dept-save-${dept.name}`}>
          Salvar
        </button>
      )}
    </li>
  );
}
