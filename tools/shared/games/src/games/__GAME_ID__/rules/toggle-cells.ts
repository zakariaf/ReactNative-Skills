// src/games/__GAME_ID__/rules/toggle-cells.ts
import type { Cell } from './__GAME_ID__-types';

/** The cell and its orthogonal neighbours that exist on a cols x rows grid, in index order. */
export function neighbourhood(cols: number, rows: number, index: number): number[] {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const cells = [index];
  if (row > 0) cells.push(index - cols);
  if (col > 0) cells.push(index - 1);
  if (col < cols - 1) cells.push(index + 1);
  if (row < rows - 1) cells.push(index + cols);
  return cells.sort((a, b) => a - b);
}

function toggled(cell: Cell): Cell {
  return cell === 1 ? 0 : 1;
}

/** A new cell list with every listed index toggled (0 <-> 1). Never mutates its input. */
export function toggleCells(cells: readonly Cell[], indices: readonly number[]): Cell[] {
  return cells.map((cell, index) => (indices.includes(index) ? toggled(cell) : cell));
}
