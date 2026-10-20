import { useEffect, useRef, useState } from 'react';
import { PET_ACTS, PET_ACT_LABELS, type PetAct } from '@workverse/shared';
import { net } from '../net';
import { emit, listen } from '../bus';
import { clampMenu } from '../game/petLogic';
import './pet.css';

const MENU_W = 190;
const MENU_H = 196;
const ICONS: Record<PetAct, string> = { pat: 'pet-ic-heart', treat: 'pet-ic-bone', call: 'pet-ic-call', play: 'pet-ic-ball' };

/**
 * Menu do Byte (o pet do escritorio): abre ao clicar nele. As quatro acoes sao mensagens `pet_do`; quem decide e valida
 * (distancia, cooldown, taxa) e o servidor, que responde com um erro `pet_*` mostrado aqui como aviso pequeno.
 */
export function PetMenu() {
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const off1 = listen('petClick', (d) => d && setMenu(d));
    const off2 = listen('closeMenus', () => setMenu(null));
    const off3 = net.on((m) => {
      if (m.t === 'error' && m.code.startsWith('pet_')) setNotice(m.message);
    });
    return () => {
      off1();
      off2();
      off3();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!menu) return;
    first.current?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.('.pet-menu') && !t?.closest?.('canvas')) setMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  const act = (a: PetAct) => {
    if (a === 'play') emit('petPlay');
    else net.send({ t: 'pet_do', act: a });
    setMenu(null);
    if (a === 'play') setNotice('Mexa o mouse pela sala: o Byte vai atrás do ponteiro!');
  };

  const pos = menu ? clampMenu(menu.x, menu.y, MENU_W, MENU_H, window.innerWidth, window.innerHeight) : null;
  return (
    <>
      {menu && pos && (
        <div className="ctx pet-menu" style={{ left: pos.left, top: pos.top }} role="menu" aria-label={`Ações com ${menu.name}`} data-testid="pet-menu">
          <div className="ctx-title pet-title">
            {menu.name} <span className="pet-chip">pet</span>
          </div>
          {PET_ACTS.map((a, i) => (
            <button key={a} ref={i === 0 ? first : undefined} role="menuitem" onClick={() => act(a)} data-testid={`pet-act-${a}`}>
              <span className={`pet-ic ${ICONS[a]}`} aria-hidden="true" /> {PET_ACT_LABELS[a]}
            </button>
          ))}
        </div>
      )}
      {notice && (
        <div className="pet-toast" role="status" data-testid="pet-toast">
          {notice}
        </div>
      )}
    </>
  );
}
