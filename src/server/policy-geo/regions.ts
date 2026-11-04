/**
 * England's regions and the local authorities CSB starts with. Public reference data: names only, no procedures.
 * Administrators can add further local authorities from Branch & Local Authority Configuration without a code change.
 */
export const REGIONS = [
  { code: "LONDON", name: "London" },
  { code: "NORTH_WEST", name: "North West" },
  { code: "SOUTH_EAST", name: "South East" },
  { code: "NORTH_EAST", name: "North East" },
  { code: "YORKSHIRE", name: "Yorkshire and the Humber" },
  { code: "EAST_MIDLANDS", name: "East Midlands" },
  { code: "WEST_MIDLANDS", name: "West Midlands" },
  { code: "EAST", name: "East of England" },
  { code: "SOUTH_WEST", name: "South West" },
] as const;

export type RegionCode = (typeof REGIONS)[number]["code"];
export const REGION_CODES = REGIONS.map((r) => r.code) as [RegionCode, ...RegionCode[]];
export const regionName = (code: string | null | undefined) => REGIONS.find((r) => r.code === code)?.name ?? (code ? code : "Not set");

export const laCode = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const LONDON = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney",
  "Hammersmith and Fulham", "Haringey", "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames", "Southwark", "Sutton", "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
];

export const LOCAL_AUTHORITIES: { code: string; name: string; regionCode: RegionCode; subRegion: string | null }[] = [
  ...LONDON.map((name) => ({ code: laCode(name), name, regionCode: "LONDON" as const, subRegion: null })),
  ...["Liverpool", "Knowsley", "Sefton", "St Helens", "Wirral"].map((name) => ({ code: laCode(name), name, regionCode: "NORTH_WEST" as const, subRegion: "Merseyside" })),
  { code: "halton", name: "Halton", regionCode: "NORTH_WEST", subRegion: null },
  ...["Portsmouth", "Southampton", "Hampshire", "Isle of Wight"].map((name) => ({ code: laCode(name), name, regionCode: "SOUTH_EAST" as const, subRegion: "Hampshire and Isle of Wight" })),
];
