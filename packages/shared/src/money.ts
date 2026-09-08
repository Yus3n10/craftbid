/**
 * Money is always an integer number of centavos. No floating point value ever
 * represents an amount of money, because binary floats cannot hold 0.1 exactly
 * and rounding drift on prices is not acceptable in a marketplace.
 */

const CENTAVOS_PER_PESO = 100;

export function pesosToCentavos(pesos: number): number {
  if (!Number.isFinite(pesos)) {
    throw new TypeError("Peso amount must be a finite number");
  }
  return Math.round(pesos * CENTAVOS_PER_PESO);
}

export function centavosToPesos(centavos: number): number {
  assertCentavos(centavos);
  return centavos / CENTAVOS_PER_PESO;
}

export function assertCentavos(centavos: number): void {
  if (!Number.isInteger(centavos)) {
    throw new TypeError(`Centavo amount must be an integer, got ${centavos}`);
  }
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats centavos as "₱1,500.00". */
export function formatPeso(centavos: number): string {
  assertCentavos(centavos);
  return pesoFormatter.format(centavos / CENTAVOS_PER_PESO);
}

/**
 * Formats centavos compactly for dense UI, dropping the decimals when the
 * amount is a whole number of pesos: "₱1,500" but "₱1,500.50".
 */
export function formatPesoCompact(centavos: number): string {
  assertCentavos(centavos);
  if (centavos % CENTAVOS_PER_PESO === 0) {
    return `₱${(centavos / CENTAVOS_PER_PESO).toLocaleString("en-PH")}`;
  }
  return formatPeso(centavos);
}
