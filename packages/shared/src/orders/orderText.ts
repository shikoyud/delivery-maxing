import { namesConfig, type ItemsConfig } from '../config';
import type { Rng } from '../util/rng';
import type { Poi } from '../world/mapTypes';
import type { Order } from './types';

// Order text (city design section 6.2): "Pick up 2 baguettes and a sourdough from Crumb & Co. Bakery, 14 Market St."
// and "Deliver to 7 Uptown Ave, apt 4". The household's name is shown beside the dropoff line, not in it. Greybox POIs
// have no address and are named instead.

/** "<name>, <address>", or the name alone when the POI has no address. */
function place(poi: Poi): string {
  return poi.address ? `${poi.name}, ${poi.address}` : poi.name;
}

/** "Pick up <item>[ (<kg> kg)] from <name>, <address>." */
export function pickupText(poi: Poi, item: string, kg: number | null): string {
  return `Pick up ${item}${kg !== null ? ` (${kg} kg)` : ''} from ${place(poi)}.`;
}

/** "Deliver to <address>" (the name when the POI has no address). */
export function dropoffText(poi: Poi): string {
  return `Deliver to ${poi.address || poi.name}`;
}

/** Both lines of an order: the pickup sentence and the dropoff line. */
export function orderText(order: Pick<Order, 'kind' | 'item' | 'weightKg'>, pickup: Poi, dropoff: Poi): { pickup: string; dropoff: string } {
  const kg = order.kind === 'package' ? order.weightKg : null;
  return { pickup: pickupText(pickup, order.item, kg), dropoff: dropoffText(dropoff) };
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * A quantity and concrete things for a catalog `poi.items` phrase, from names.json `items` ("bread and pastries" ->
 * "2 baguettes and a sourdough"). A phrase the table does not know (the greybox's "noodles") is returned as it is,
 * without drawing from `rng`.
 */
export function itemPhrase(items: string, rng: Rng, table: ItemsConfig = namesConfig.items): string {
  const entry = Object.hasOwn(table.phrases, items) ? table.phrases[items] : undefined;
  if (!entry || entry.things.length === 0) return items;
  const count = (): number => 1 + Math.floor(rng() * entry.max);
  const say = ([one = '', many = one]: string[], n: number): string => (n === 1 ? `${article(one)} ${one}` : `${n} ${many}`);
  const i = Math.floor(rng() * entry.things.length);
  const first = say(entry.things[i]!, count());
  if (entry.things.length < 2 || rng() >= table.secondChance) return first;
  // a different second thing
  const j = (i + 1 + Math.floor(rng() * (entry.things.length - 1))) % entry.things.length;
  return `${first} and ${say(entry.things[j]!, count())}`;
}
