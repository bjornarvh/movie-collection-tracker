import { describe, expect, it } from 'vitest';
import { classify } from '../src/lib/classify';

// Real names sampled from M:\Movies
describe('classify', () => {
  it('pipeline DVD encode is an owned DVD', () => {
    const c = classify({ fileName: 'Casino Royale (2006).576p.hevc.mkv', width: 720, height: 576 });
    expect(c).toMatchObject({ format: 'dvd', ownership: 'owned' });
  });

  it('untagged 4K file is unverified UHD', () => {
    const c = classify({ fileName: 'Casino Royale (2006).mkv', width: 3840, height: 2160 });
    expect(c).toMatchObject({ format: 'uhd', ownership: 'unverified' });
  });

  it('pipeline 1080p encode is an owned Blu-ray', () => {
    const c = classify({ fileName: 'Me, Myself & Irene (2000).1080p.hevc.mkv', width: 1920, height: 1040 });
    expect(c).toMatchObject({ format: 'bluray', ownership: 'owned' });
  });

  it('pipeline encode with edition tag', () => {
    const c = classify({ fileName: "Das Boot (1981).576p.hevc {edition-Director's Cut}.mkv", width: 720, height: 576 });
    expect(c).toMatchObject({ format: 'dvd', ownership: 'owned' });
  });

  it('scene release with group suffix is pirated', () => {
    const c = classify({
      fileName: 'Memento.2000.REMASTERED.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv',
      width: 1920,
      height: 1080,
    });
    expect(c).toMatchObject({ format: 'bluray', ownership: 'pirated' });
    expect(c.reasons.join()).toContain('GalaxyRG265');
  });

  it('sample file is pirated', () => {
    const c = classify({ fileName: 'The.Silence.of.the.Lambs.1991.1080p.Bluray.x264.AC3-ETRG.Sample.mp4', width: 1920, height: 1080 });
    expect(c.ownership).toBe('pirated');
  });

  it('MakeMKV rip is owned', () => {
    expect(classify({ fileName: 'title_t00.mkv', width: 1920, height: 1080 }).ownership).toBe('owned');
    expect(classify({ fileName: 'Hitmans Wife Bodyguard_t00.mkv', width: 1920, height: 1080 }).ownership).toBe('owned');
  });

  it('bare 4K REMUX with edition is owned UHD', () => {
    const c = classify({ fileName: 'Independence Day (1996).4k.REMUX {edition-Extended Cut}.mkv', width: 3840, height: 2160 });
    expect(c).toMatchObject({ format: 'uhd', ownership: 'owned' });
  });

  it('old Nordic XviD rip is a pirated DVD', () => {
    const c = classify({
      fileName: 'Elling 3 - Elsk meg i morgen.Norsk tale og tekst.xvid.saga.avi',
      width: 640,
      height: 272,
    });
    expect(c).toMatchObject({ format: 'dvd', ownership: 'pirated' });
  });

  it('multi-part names classify on the base name', () => {
    const c = classify({ fileName: 'Arn - The Knight Templar (2007) - CD1.avi', width: 720, height: 304 });
    expect(c).toMatchObject({ format: 'dvd', ownership: 'unverified' });
  });

  it('WEB-DL is pirated digital, even at 1080p', () => {
    const c = classify({
      fileName: 'Cloudy With A Chance Of Meatballs 2009 NORDiC 1080p WEB-DL H 264 DDP5 1-NoTrace.mkv',
      width: 1920,
      height: 1080,
    });
    expect(c).toMatchObject({ format: 'digital', ownership: 'pirated' });
  });

  it('720p BluRay stays bluray', () => {
    const c = classify({ fileName: 'Heat.1995.720p.BluRay.x264-SPARKS.mkv', width: 1280, height: 720 });
    expect(c).toMatchObject({ format: 'bluray', ownership: 'pirated' });
  });

  it('titles that look like group names are not flagged', () => {
    expect(classify({ fileName: 'Don Jon (2013).mkv', width: 1920, height: 1080 }).ownership).toBe('unverified');
    expect(classify({ fileName: 'Spider-Man (2002).1080p.hevc.mkv', width: 1920, height: 1080 }).ownership).toBe('owned');
  });

  it('nfo release name marks an untagged file as pirated', () => {
    const c = classify({
      fileName: 'American Pie Reunion (2012).mkv',
      width: 1920,
      height: 1080,
      nfoText: '[b]American.Pie.Reunion.2012.UNRATED.1080p.BluRay.H264.AAC-RARBG[/b]\n',
    });
    expect(c.ownership).toBe('pirated');
  });

  it('DVD with VobSub subtitles leans owned', () => {
    const c = classify({
      fileName: 'A Somewhat Gentle Man (2010).mkv',
      width: 720,
      height: 576,
      siblings: ['A Somewhat Gentle Man (2010).nor.idx', 'A Somewhat Gentle Man (2010).nor.sub'],
    });
    expect(c).toMatchObject({ format: 'dvd', ownership: 'owned' });
    expect(c.confidence).toBeLessThan(0.5);
  });

  it('falls back to name hints without resolution', () => {
    expect(classify({ fileName: 'Ben-Hur (1959).4k.hevc.mkv' }).format).toBe('uhd');
    expect(classify({ fileName: 'Casino Royale (2006).576p.hevc.mkv' }).format).toBe('dvd');
  });
});
