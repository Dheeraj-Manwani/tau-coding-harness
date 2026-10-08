/**
 * Games offered while tau builds. Every entry comes from GameDistribution, a
 * portal that licenses its catalogue for embedding on other sites; the better
 * known portals (Poki, CrazyGames) refuse to load in a frame. To add a game,
 * open its page on gamedistribution.com: `id` is the hash in its embed URL and
 * `thumbnail` is the 512x384 file name listed with its assets.
 */
export interface Game {
  id: string;
  title: string;
  blurb: string;
  thumbnail: string;
}

export const GAMES: readonly Game[] = [
  {
    id: "5b0abd4c0faa4f5eb190a9a16d5a1b4c",
    title: "Moto X3M",
    blurb: "Stunt bike racing over 25 obstacle tracks.",
    thumbnail: "5b0abd4c0faa4f5eb190a9a16d5a1b4c-512x384.jpeg",
  },
  {
    id: "f2af2ecc05a445edb6862c589e996a7e",
    title: "Tomb Runner",
    blurb: "Endless runner: jump, slide and surf through the ruins.",
    thumbnail: "f2af2ecc05a445edb6862c589e996a7e-512x384.jpg",
  },
  {
    id: "d02120780e594158ab61869028223cf1",
    title: "8 Ball Pool",
    blurb: "Classic billiards against a computer opponent.",
    thumbnail: "d02120780e594158ab61869028223cf1-512x384.jpg",
  },
  {
    id: "69d78d071f704fa183d75b4114ae40ec",
    title: "Basketball Stars",
    blurb: "One-on-one street basketball.",
    thumbnail: "69d78d071f704fa183d75b4114ae40ec-512x384.jpg",
  },
  {
    id: "571b9df027e449f78e3869ba19658754",
    title: "Penalty Shooters 2",
    blurb: "Take the penalties, then save them.",
    thumbnail: "571b9df027e449f78e3869ba19658754-512x384.jpeg",
  },
  {
    id: "5e3ad8d8da854ba5985ac78212520238",
    title: "Stack Ball",
    blurb: "Smash a ball down through a spinning tower.",
    thumbnail: "5e3ad8d8da854ba5985ac78212520238-512x384.jpeg",
  },
];

export function gameThumbnailUrl(game: Game): string {
  return `https://img.gamedistribution.com/${game.thumbnail}`;
}

/**
 * The frame URL for a game. GameDistribution asks for the embedding page; it
 * gets the app's origin only, since a project URL carries the project id. The
 * gdpr flags ask for ads that aren't personalised, because tau has no consent
 * prompt of its own for them.
 */
export function gameEmbedUrl(game: Game, appOrigin: string): string {
  const params = new URLSearchParams({
    gd_sdk_referrer_url: `${appOrigin}/`,
    "gdpr-tracking": "0",
    "gdpr-targeting": "0",
    "gdpr-third-party": "0",
  });
  return `https://html5.gamedistribution.com/${game.id}/?${params.toString()}`;
}
