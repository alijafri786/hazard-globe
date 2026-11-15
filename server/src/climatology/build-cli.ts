/**
 * Builds the storm climatology from NOAA's IBTrACS into server/assets/climatology/.
 *
 *   npm run climatology --workspace server                 # downloads the since-1980 CSV (~145 MB)
 *   npm run climatology --workspace server -- path/to.csv  # or reads one already downloaded
 *
 * Run yearly (.github/workflows/climatology.yml does) once a hurricane season is in the record.
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { USER_AGENT } from '../gdacs.js'
import { buildClimatology, readStorms } from './build.js'

const URL_SINCE_1980 =
  'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.since1980.list.v04r01.csv'
const OUT = new URL('../../assets/climatology/', import.meta.url)

async function input(): Promise<NodeJS.ReadableStream> {
  const file = process.argv[2]
  if (file) return createReadStream(file)
  console.log(`Downloading ${URL_SINCE_1980}`)
  const res = await fetch(URL_SINCE_1980, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok || !res.body) throw new Error(`IBTrACS ${res.status}`)
  return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
}

const started = Date.now()
const storms = await readStorms(createInterface({ input: await input(), crlfDelay: Infinity }))
console.log(`${storms.length} storms read in ${((Date.now() - started) / 1000).toFixed(1)}s`)
const { meta, grids, tracks } = buildClimatology(storms)

await mkdir(OUT, { recursive: true })
await writeFile(new URL('grids.bin.gz', OUT), gzipSync(grids, { level: 9 }))
await writeFile(new URL('tracks.bin.gz', OUT), gzipSync(tracks, { level: 9 }))
await writeFile(new URL('meta.json', OUT), `${JSON.stringify({ ...meta, built: new Date().toISOString() })}\n`)
console.log(
  `${meta.storms} storms, ${meta.from} to ${meta.to} (${meta.years} years); ` +
    `grids ${(grids.length / 1e6).toFixed(1)} MB, tracks ${(tracks.length / 1e6).toFixed(1)} MB before compression. ` +
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s`,
)
