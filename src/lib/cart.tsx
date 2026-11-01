import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ExtraId } from "./menu";
import type { Fulfillment, Plate } from "./pricing";

interface CartState {
  plates: Plate[];
  extras: Partial<Record<ExtraId, number>>;
  fulfillment: Fulfillment;
}
interface CartCtx extends CartState {
  addPlate: (p: Omit<Plate, "id">) => void;
  removePlate: (id: string) => void;
  setExtra: (id: ExtraId, qty: number) => void;
  setFulfillment: (f: Fulfillment) => void;
  /** Emptied once an order is placed and paid. */
  clear: () => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  count: number;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "spaghetti-lab-cart";
const empty: CartState = { plates: [], extras: {}, fulfillment: "pickup" };

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(empty);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...empty, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, loaded]);

  const count = state.plates.length + Object.values(state.extras).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Ctx.Provider
      value={{
        ...state,
        count,
        open,
        setOpen,
        addPlate: (p) =>
          setState((s) => ({ ...s, plates: [...s.plates, { ...p, id: crypto.randomUUID() }] })),
        removePlate: (id) =>
          setState((s) => ({ ...s, plates: s.plates.filter((p) => p.id !== id) })),
        setExtra: (id, qty) =>
          setState((s) => ({ ...s, extras: { ...s.extras, [id]: Math.max(0, qty) } })),
        setFulfillment: (fulfillment) => setState((s) => ({ ...s, fulfillment })),
        clear: () => setState((s) => ({ ...empty, fulfillment: s.fulfillment })),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be inside CartProvider");
  return c;
}
