/** Характеристика каталога, приведённая к фактической Численности Отряда.
 *  Характеристики даны на сотню солдат. */
export const scaleToHeadcount = (perHundred: number, headcount: number): number =>
  (perHundred * headcount) / 100;
