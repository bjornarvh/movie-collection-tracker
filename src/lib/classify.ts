import type { Format, Ownership } from '../db/schema';
import { stripExt } from './paths';

export type ClassifyInput = {
  /** File name of the (first) part, with or without extension. */
  fileName: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  /** Other file names in the same folder (subtitles etc). */
  siblings?: string[];
  /** Contents of an .nfo next to the file, if one could be read. */
  nfoText?: string | null;
};

export type Classification = {
  format: Format;
  ownership: Ownership;
  /** How sure we are about the ownership suggestion, 0–1. */
  confidence: number;
  reasons: string[];
};

// Distinctive P2P groups/sites that can't be mistaken for a word in a movie title.
// Other groups are caught by RELEASE_GROUP_SUFFIX instead.
const KNOWN_GROUPS = /(?:^|[.\s_[(-])(RARBG|YTS(?:\.[A-Z]{2})?|YIFY|GalaxyRG\d*|ETRG|NoTrace|NorTekst|TGx|QxR|Tigole)(?=[.\s_\])-]|$)/i;
const QUALITY_TOKEN = /(?:^|[.\s_-])(2160p|1080p|720p|576p|480p|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|dvdrip|remux|x264|x265|h\.?264|h\.?265|hevc|xvid|divx|10bit|dts|ddp?5\.1|aac|ac3|truehd|atmos)(?=[.\s_-]|$)/i;
/** `...x265.10bit-GalaxyRG265`: dotted release name ending in "-GROUP". */
const RELEASE_GROUP_SUFFIX = /[.\s](?:[\w.]+)-([A-Za-z0-9]{2,})$/;
const WEB_SOURCE = /(?:^|[.\s_-])(web-?dl|webrip|web|amzn|nf|dsnp|hmax|atvp)(?=[.\s_-]|$)/i;
const DVD_SOURCE = /(?:^|[.\s_-])(dvdrip|dvd5|dvd9|dvd)(?=[.\s_-]|$)/i;
const BLURAY_SOURCE = /(?:^|[.\s_-])(bluray|blu-ray|bdrip|brrip|bdremux)(?=[.\s_-]|$)/i;
const UHD_TAG = /(?:^|[.\s_-])(2160p|4k|uhd)(?=[.\s_-]|$)/i;
const OLD_P2P = /(?:^|[.\s_-])(xvid|divx|nordic|norsk tale og tekst|swesub|dansub)(?=[.\s_-]|$)/i;
const SAMPLE = /(?:^|[.\s_-])sample$/i;

/** media-pipeline output: "Title (Year).576p.hevc", "Title (Year).4k.hevc {edition-X}". */
const PIPELINE_NAME = /\.(?:480p|576p|720p|1080p|2160p|4k)\.hevc(?:\s*\{edition-[^}]+\})?$/i;
/** MakeMKV output: "title_t00", "Some Disc Name_t01". */
const MAKEMKV_NAME = /(?:^title_t\d{2}|_t\d{2})$/i;
/** "Title (Year).4K.REMUX" without a release group: a remux of a disc, usually your own. */
const BARE_REMUX = /\.(?:4k|2160p|1080p)?\.?remux(?:\s*\{edition-[^}]+\})?$/i;
/** Release-name line inside an .nfo, e.g. "[b]American.Pie.Reunion.2012.UNRATED.1080p.BluRay.H264.AAC-RARBG[/b]". */
const NFO_RELEASE = /\b[\w'.]+\.(?:19|20)\d{2}\.[\w.]*?(?:2160p|1080p|720p|576p|480p|bluray|web-?dl|webrip|dvdrip)[\w.]*-[A-Za-z0-9]+\b/i;
const NFO_UHD_SOURCE = /source\s*[:=].*\b(4k|uhd|2160p)\b/i;

function formatFromResolution(width?: number | null, height?: number | null): Format | null {
  if (!width && !height) return null;
  const w = width ?? 0;
  const h = height ?? 0;
  if (w >= 3000 || h >= 1600) return 'uhd';
  if (w >= 1200 || h > 800) return 'bluray';
  if (w >= 1000 || h >= 700) return 'digital'; // 720p: usually WEB, refined below
  return 'dvd';
}

export function classify(input: ClassifyInput): Classification {
  const name = stripExt(input.fileName.trim()).replace(/\s*-\s*(?:cd|pt|part|disc)\s*\d+$/i, '');
  const reasons: string[] = [];

  // ---- format ------------------------------------------------------------
  let format = formatFromResolution(input.width, input.height);
  if (format) reasons.push(`${input.width}×${input.height} → ${format}`);

  if (WEB_SOURCE.test(name) && !BLURAY_SOURCE.test(name)) {
    if (format !== 'digital') reasons.push('WEB source tag → digital');
    format = 'digital';
  } else if (format === 'digital' && BLURAY_SOURCE.test(name)) {
    format = 'bluray';
    reasons.push('720p with BluRay tag → bluray');
  } else if (format === 'bluray' && UHD_TAG.test(name) && /remux|\.4k\./i.test(`.${name}.`)) {
    // UHD disc encoded down to 1080p but still tagged as 4K
    format = 'uhd';
    reasons.push('4K tag on a 1080p file → uhd');
  } else if (!format) {
    if (UHD_TAG.test(name) || (input.nfoText && NFO_UHD_SOURCE.test(input.nfoText))) format = 'uhd';
    else if (DVD_SOURCE.test(name) || /\.(?:576p|480p)\./i.test(`${name}.`)) format = 'dvd';
    else if (/720p/i.test(name) && !BLURAY_SOURCE.test(name)) format = 'digital';
    else format = 'bluray';
    reasons.push(`no resolution; name suggests ${format}`);
  }

  // ---- ownership ---------------------------------------------------------
  const group = name.match(KNOWN_GROUPS)?.[1] ?? null;
  const suffix = QUALITY_TOKEN.test(name) ? (name.match(RELEASE_GROUP_SUFFIX)?.[1] ?? null) : null;
  const nfoRelease = input.nfoText?.match(NFO_RELEASE)?.[0] ?? null;

  if (SAMPLE.test(name)) {
    return { format, ownership: 'pirated', confidence: 0.9, reasons: [...reasons, 'sample file from a scene release'] };
  }
  if (suffix && !/^(?:hevc|x265|x264|remux)$/i.test(suffix)) {
    return { format, ownership: 'pirated', confidence: 0.9, reasons: [...reasons, `release group "-${suffix}"`] };
  }
  if (group) {
    return { format, ownership: 'pirated', confidence: 0.85, reasons: [...reasons, `release group "${group}"`] };
  }
  if (WEB_SOURCE.test(name) && QUALITY_TOKEN.test(name)) {
    return { format, ownership: 'pirated', confidence: 0.75, reasons: [...reasons, 'WEB release name'] };
  }
  if (OLD_P2P.test(name)) {
    return { format, ownership: 'pirated', confidence: 0.7, reasons: [...reasons, 'XviD/Nordic release naming'] };
  }
  if (nfoRelease) {
    return { format, ownership: 'pirated', confidence: 0.8, reasons: [...reasons, `nfo names release "${nfoRelease}"`] };
  }
  if (PIPELINE_NAME.test(name)) {
    return { format, ownership: 'owned', confidence: 0.8, reasons: [...reasons, 'media-pipeline encode naming'] };
  }
  if (MAKEMKV_NAME.test(name)) {
    return { format, ownership: 'owned', confidence: 0.85, reasons: [...reasons, 'MakeMKV disc rip naming'] };
  }
  if (BARE_REMUX.test(name)) {
    return { format, ownership: 'owned', confidence: 0.6, reasons: [...reasons, 'REMUX without release group'] };
  }
  if (format === 'dvd' && input.siblings?.some((s) => /\.(?:idx|sub)$/i.test(s))) {
    return { format, ownership: 'owned', confidence: 0.4, reasons: [...reasons, 'DVD resolution with VobSub subtitles'] };
  }
  return { format, ownership: 'unverified', confidence: 0, reasons: [...reasons, 'no ownership hints in name'] };
}
