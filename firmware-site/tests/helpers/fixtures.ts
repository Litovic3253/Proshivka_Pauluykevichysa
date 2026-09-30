import { readFileSync } from 'node:fs'

export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))
}

export function loadFixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
}
