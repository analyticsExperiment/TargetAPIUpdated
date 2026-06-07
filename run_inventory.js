import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiError,
  extractArrayFromResponse,
  extractPaginationInfo,
  fetchJson,
  getAccessToken,
  safeFileName,
  writeCsv,
  writeJson
} from "./target-activities-inventory.js";
import { createBusinessInventoryWorkbook } from "./create-business-inventory-workbook.js";
import {
  ACTIVITIES_LIST_COLUMNS,
  ACTIVITY_DETAILS_COLUMNS,
  AUDIENCES_LIST_COLUMNS,
  AUDIENCE_DETAILS_COLUMNS,
  OFFERS_LIST_COLUMNS,
  OFFER_DETAILS_COLUMNS,
  buildActivitiesListRows,
  buildActivityDetailsCombined,
  buildActivityDetailsRows,
  buildAudiencesListRows,
  buildAudienceDetailsCombined,
  buildAudienceDetailsRows,
  buildOfferDetailsCombined,
  buildOfferDetailsRows,
  buildOffersListRows,
  collectDetailItemsWithErrors
} from "./business-inventory.js";

const DEFAULT_IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const DEFAULT_TARGET_BASE_URL = "https://mc.adobe.io";
const DEFAULT_ACCEPT_HEADER = "application/vnd.adobe.target.v3+json";
const DEFAULT_OFFER_ACCEPT_HEADER = "application/vnd.adobe.target.v2+json";
const DEFAULT_OUTPUT_DIR = "./target-inventory-output";
const DEFAULT_LIMIT = 100;
const DEFAULT_CONCURRENCY = 3;
const MAX_PAGES = 10000;

const OFFER_DETAIL_ROUTES = {
  content: (offerId) => `/target/offers/content/${encodeURIComponent(String(offerId))}`
};

export function parseTargetInventoryCliArgs(argv = process.argv.slice(2)) {
  const options = {
    scope: "all",
    activities: [],
    offers: [],
    audiences: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const nextValue = inlineValue ?? argv[index + 1];

    if (key === "--scope") {
      options.scope = nextValue;
      if (inlineValue === undefined) index += 1;
    } else if (key === "--out") {
      options.outDir = nextValue;
      if (inlineValue === undefined) index += 1;
    } else if (key === "--limit") {
      options.limit = Number(nextValue);
      if (inlineValue === undefined) index += 1;
    } else if (key === "--concurrency") {
      options.concurrency = Number(nextValue);
      if (inlineValue === undefined) index += 1;
    } else if (key === "--activity") {
      options.activities.push(parseTypedId(nextValue, "activity"));
      if (inlineValue === undefined) index += 1;
    } else if (key === "--offer") {
      options.offers.push(parseOfferArgument(nextValue));
      if (inlineValue === undefined) index += 1;
    } else if (key === "--audience") {
      options.audiences.push({ id: nextValue });
      if (inlineValue === undefined) index += 1;
    } else if (key === "--skip-details") {
      options.skipDetails = true;
    } else if (key === "--no-workbook") {
      options.noWorkbook = true;
    } else if (key === "--help" || key === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function loadTargetInventoryConfig(cliOptions = parseTargetInventoryCliArgs(), env = process.env) {
  const sharedLimit = toPositiveInteger(cliOptions.limit, undefined, undefined);
  const sharedConcurrency = toPositiveInteger(cliOptions.concurrency, undefined, undefined);

  return {
    clientId: env.ADOBE_CLIENT_ID,
    clientSecret: env.ADOBE_CLIENT_SECRET,
    orgId: env.ADOBE_ORG_ID,
    tenant: env.ADOBE_TENANT,
    scopes: env.ADOBE_SCOPES,
    imsTokenUrl: env.ADOBE_IMS_TOKEN_URL || DEFAULT_IMS_TOKEN_URL,
    targetBaseUrl: env.ADOBE_TARGET_BASE_URL || DEFAULT_TARGET_BASE_URL,
    acceptHeader: env.TARGET_ACCEPT_HEADER || DEFAULT_ACCEPT_HEADER,
    offerAcceptHeader: env.TARGET_OFFER_ACCEPT_HEADER || DEFAULT_OFFER_ACCEPT_HEADER,
    outDir: cliOptions.outDir || env.TARGET_INVENTORY_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    activityLimit: sharedLimit ?? toPositiveInteger(env.TARGET_ACTIVITY_LIMIT, undefined, DEFAULT_LIMIT),
    activityConcurrency: sharedConcurrency ?? toPositiveInteger(env.TARGET_ACTIVITY_CONCURRENCY, undefined, DEFAULT_CONCURRENCY),
    offerLimit: sharedLimit ?? toPositiveInteger(env.TARGET_OFFER_LIMIT, undefined, DEFAULT_LIMIT),
    offerConcurrency: sharedConcurrency ?? toPositiveInteger(env.TARGET_OFFER_CONCURRENCY, undefined, DEFAULT_CONCURRENCY),
    audienceLimit: sharedLimit ?? toPositiveInteger(env.TARGET_AUDIENCE_LIMIT, undefined, DEFAULT_LIMIT),
    audienceConcurrency: sharedConcurrency ?? toPositiveInteger(env.TARGET_AUDIENCE_CONCURRENCY, undefined, DEFAULT_CONCURRENCY),
    scope: normalizeScope(cliOptions.scope),
    activities: cliOptions.activities,
    offers: cliOptions.offers,
    audiences: cliOptions.audiences,
    skipDetails: Boolean(cliOptions.skipDetails),
    noWorkbook: Boolean(cliOptions.noWorkbook),
    help: Boolean(cliOptions.help)
  };
}

export async function runTargetInventory(config = loadTargetInventoryConfig()) {
  validateAuthConfig(config);
  validateTargetConfig(config);

  const startedAt = new Date();
  const runDir = path.resolve(config.outDir, formatRunTimestamp(startedAt));
  const dirs = createRunDirs(runDir);
  const errors = [];
  const skippedItems = [];
  const extractionWarnings = [];
  const state = createEmptyInventoryState();

  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));

  if (shouldRunScope(config.scope, "activities")) {
    Object.assign(
      state.activities,
      await runActivitiesSection({ config, dirs, runDir, errors, skippedItems, extractionWarnings })
    );
  } else {
    skippedItems.push({ section: "activities", reason: `Scope ${config.scope} did not include activities.` });
  }

  if (shouldRunScope(config.scope, "offers")) {
    Object.assign(state.offers, await runOffersSection({ config, dirs, runDir, errors, skippedItems }));
  } else {
    skippedItems.push({ section: "offers", reason: `Scope ${config.scope} did not include offers.` });
  }

  if (shouldRunScope(config.scope, "audiences")) {
    Object.assign(state.audiences, await runAudiencesSection({ config, dirs, runDir, errors, skippedItems }));
  } else {
    skippedItems.push({ section: "audiences", reason: `Scope ${config.scope} did not include audiences.` });
  }

  await writePrimaryOutputs({ dirs, state, errors, skippedItems, extractionWarnings });

  const summaryMarkdown = buildSummaryMarkdown({
    runDir,
    startedAt,
    completedAt: new Date(),
    state,
    errors,
    skippedItems,
    extractionWarnings
  });
  await writeFile(path.join(dirs.reports, "inventory-summary.md"), summaryMarkdown, "utf8");

  const workbookResult = config.noWorkbook
    ? undefined
    : await createBusinessInventoryWorkbook({ inputDir: runDir });

  return {
    runDir,
    csvDir: dirs.csv,
    workbookFile: workbookResult?.outputFile,
    activityRows: state.activities.detailRows.length,
    offerRows: state.offers.detailRows.length,
    audienceRows: state.audiences.detailRows.length,
    errors: errors.length,
    skippedItems: skippedItems.length
  };
}

async function runActivitiesSection({ config, dirs, runDir, errors, skippedItems, extractionWarnings }) {
  const listResult = await loadListOrSpecificItems({
    specificItems: config.activities,
    sectionName: "activities",
    listEndpointPath: "/target/activities",
    limit: config.activityLimit,
    config,
    rawListPath: path.join(dirs.raw, "activities-list.json")
  });
  const activityList = listResult.items;

  if (config.skipDetails) {
    skippedItems.push({ section: "activities", reason: "--skip-details was provided." });
    return {
      listItems: activityList,
      listRows: buildActivitiesListRows(activityList),
      detailPackages: [],
      detailRows: [],
      combined: []
    };
  }

  const fetchable = [];
  activityList.forEach((activity, index) => {
    const identity = getActivityIdentity(activity);
    if (!identity.id || !identity.type) {
      skippedItems.push({
        section: "activities",
        itemIndex: index,
        item: activity,
        reason: "Activity item did not include both id and type."
      });
      return;
    }
    fetchable.push({ ...activity, id: identity.id, type: identity.type });
  });

  const detailResult = await collectDetailItemsWithErrors({
    items: fetchable,
    concurrency: config.activityConcurrency,
    fetchDetail: async (activity) => {
      const endpointPath = `/target/activities/${encodeURIComponent(String(activity.type).toLowerCase())}/${encodeURIComponent(
        String(activity.id)
      )}`;
      const detail = await fetchTargetJson(endpointPath, config);
      const root = getResponseRoot(detail);
      const safeName = safeFileName(root.name ?? activity.name ?? activity.id);
      const rawPath = path.join(dirs.rawActivities, `${safeFileName(activity.type)}-${safeFileName(activity.id)}-${safeName}.json`);
      await writeJson(rawPath, detail);
      return {
        detail,
        rawFile: toPosixPath(path.relative(runDir, rawPath)),
        endpointPath
      };
    },
    buildPackage: ({ item, detail }) => ({
      listItem: item,
      detail: detail.detail,
      rawFile: detail.rawFile,
      endpointPath: detail.endpointPath
    }),
    buildError: ({ item, error }) =>
      serializeInventoryError(error, config, {
        section: "activities",
        itemId: item.id,
        itemType: item.type,
        itemName: item.name
      })
  });

  errors.push(...detailResult.errors);

  const detailRows = detailResult.packages.flatMap((activityPackage) =>
    buildActivityDetailsRows(activityPackage, { warnings: extractionWarnings })
  );

  return {
    listItems: activityList,
    listRows: buildActivitiesListRows(activityList),
    detailPackages: detailResult.packages,
    detailRows,
    combined: buildActivityDetailsCombined(detailResult.packages, { warnings: extractionWarnings })
  };
}

async function runOffersSection({ config, dirs, runDir, errors, skippedItems }) {
  const listResult = await loadListOrSpecificItems({
    specificItems: config.offers,
    sectionName: "offers",
    listEndpointPath: "/target/offers",
    limit: config.offerLimit,
    config,
    acceptHeader: config.offerAcceptHeader,
    rawListPath: path.join(dirs.raw, "offers-list.json")
  });
  const offerList = listResult.items;

  if (config.skipDetails) {
    skippedItems.push({ section: "offers", reason: "--skip-details was provided." });
    return {
      listItems: offerList,
      listRows: buildOffersListRows(offerList),
      detailPackages: [],
      detailRows: [],
      combined: []
    };
  }

  const detailResult = await collectDetailItemsWithErrors({
    items: offerList,
    concurrency: config.offerConcurrency,
    fetchDetail: async (offer) => {
      const route = resolveOfferDetailRoute(offer);
      if (!route) {
        throw new Error(`Unsupported or unknown offer detail type: ${offer.type ?? offer.offerType ?? "unknown"}`);
      }
      const detail = await fetchTargetJson(route.endpointPath, config, { acceptHeader: config.offerAcceptHeader });
      const root = getResponseRoot(detail);
      const safeName = safeFileName(root.name ?? offer.name ?? offer.id);
      const rawPath = path.join(dirs.rawOffers, `${safeFileName(route.offerType)}-${safeFileName(route.offerId)}-${safeName}.json`);
      await writeJson(rawPath, detail);
      return {
        detail,
        rawFile: toPosixPath(path.relative(runDir, rawPath)),
        endpointPath: route.endpointPath
      };
    },
    buildPackage: ({ item, detail }) => ({
      listItem: item,
      detail: detail.detail,
      rawFile: detail.rawFile,
      endpointPath: detail.endpointPath
    }),
    buildError: ({ item, error }) =>
      serializeInventoryError(error, config, {
        section: "offers",
        itemId: item.id,
        itemType: item.type ?? item.offerType,
        itemName: item.name
      })
  });

  errors.push(...detailResult.errors);

  return {
    listItems: offerList,
    listRows: buildOffersListRows(offerList),
    detailPackages: detailResult.packages,
    detailRows: buildOfferDetailsRows(detailResult.packages),
    combined: buildOfferDetailsCombined(detailResult.packages)
  };
}

async function runAudiencesSection({ config, dirs, runDir, errors, skippedItems }) {
  const listResult = await loadListOrSpecificItems({
    specificItems: config.audiences,
    sectionName: "audiences",
    listEndpointPath: "/target/audiences",
    limit: config.audienceLimit,
    config,
    rawListPath: path.join(dirs.raw, "audiences-list.json")
  });
  const audienceList = listResult.items;

  if (config.skipDetails) {
    skippedItems.push({ section: "audiences", reason: "--skip-details was provided." });
    return {
      listItems: audienceList,
      listRows: buildAudiencesListRows(audienceList),
      detailPackages: [],
      detailRows: [],
      combined: []
    };
  }

  const detailResult = await collectDetailItemsWithErrors({
    items: audienceList,
    concurrency: config.audienceConcurrency,
    fetchDetail: async (audience) => {
      const audienceId = audience.id ?? audience.audienceId;
      if (!audienceId) throw new Error("Audience item did not include id.");
      const endpointPath = `/target/audiences/${encodeURIComponent(String(audienceId))}`;
      const detail = await fetchTargetJson(endpointPath, config);
      const root = getResponseRoot(detail);
      const safeName = safeFileName(root.name ?? audience.name ?? audienceId);
      const rawPath = path.join(dirs.rawAudiences, `${safeFileName(audienceId)}-${safeName}.json`);
      await writeJson(rawPath, detail);
      return {
        detail,
        rawFile: toPosixPath(path.relative(runDir, rawPath)),
        endpointPath
      };
    },
    buildPackage: ({ item, detail }) => ({
      listItem: item,
      detail: detail.detail,
      rawFile: detail.rawFile,
      endpointPath: detail.endpointPath
    }),
    buildError: ({ item, error }) =>
      serializeInventoryError(error, config, {
        section: "audiences",
        itemId: item.id ?? item.audienceId,
        itemName: item.name
      })
  });

  errors.push(...detailResult.errors);

  return {
    listItems: audienceList,
    listRows: buildAudiencesListRows(audienceList),
    detailPackages: detailResult.packages,
    detailRows: buildAudienceDetailsRows(detailResult.packages),
    combined: buildAudienceDetailsCombined(detailResult.packages)
  };
}

async function loadListOrSpecificItems({ specificItems, sectionName, listEndpointPath, limit, config, rawListPath, acceptHeader }) {
  if (specificItems.length > 0) {
    const raw = {
      skipped: true,
      reason: `Specific ${sectionName} were provided; ${listEndpointPath} was not called.`,
      requestedItems: specificItems
    };
    await writeJson(rawListPath, raw);
    return { items: specificItems, raw };
  }

  const raw = await fetchPaginatedTargetCollection(listEndpointPath, { config, limit, acceptHeader });
  await writeJson(rawListPath, raw.raw);
  return raw;
}

async function fetchPaginatedTargetCollection(endpointPath, { config, limit, acceptHeader }) {
  const items = [];
  const pages = [];
  let offset = 0;
  let nextUrl = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const url = nextUrl ?? buildTargetUrl(config, endpointPath, { limit, offset });
    const response = await fetchTargetJson(url, config, { acceptHeader });
    const pageItems = extractArrayFromResponse(response);
    const pagination = extractPaginationInfo(response, {
      requestLimit: limit,
      requestOffset: offset
    });

    pages.push({
      url: String(url),
      count: pageItems.length,
      response
    });
    items.push(...pageItems);

    nextUrl = pagination.nextUrl;
    if (nextUrl) continue;

    if (pagination.total !== undefined) {
      if (items.length >= pagination.total || pageItems.length === 0) break;
      offset = (pagination.offset ?? offset) + (pagination.limit ?? limit ?? pageItems.length);
      continue;
    }

    if (pagination.hasOffsetPagination && pageItems.length >= (pagination.limit ?? limit)) {
      offset = (pagination.offset ?? offset) + (pagination.limit ?? limit);
      continue;
    }

    break;
  }

  return {
    items,
    raw: pages.length === 1 ? pages[0].response : { pages, items }
  };
}

async function fetchTargetJson(endpointOrUrl, config, { refreshOnUnauthorized = true, acceptHeader } = {}) {
  const accessToken = await getAccessToken(config);
  const url = endpointOrUrl instanceof URL || /^https?:\/\//i.test(String(endpointOrUrl))
    ? endpointOrUrl
    : buildTargetUrl(config, endpointOrUrl);

  try {
    return await fetchJson(url, {
      method: "GET",
      headers: buildTargetHeaders(config, accessToken, { acceptHeader })
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && refreshOnUnauthorized) {
      const refreshedToken = await getAccessToken(config, { forceRefresh: true });
      return fetchJson(url, {
        method: "GET",
        headers: buildTargetHeaders(config, refreshedToken, { acceptHeader })
      });
    }

    if (error instanceof ApiError && error.status === 409) {
      error.message = `${error.message}; Target version conflict. Confirm TARGET_ACCEPT_HEADER is ${DEFAULT_ACCEPT_HEADER}.`;
    }

    throw error;
  }
}

async function writePrimaryOutputs({ dirs, state, errors, skippedItems, extractionWarnings }) {
  await Promise.all([
    writeJson(path.join(dirs.normalized, "activities-list.normalized.json"), state.activities.listRows),
    writeJson(path.join(dirs.normalized, "activity-details-combined.json"), state.activities.combined),
    writeJson(path.join(dirs.normalized, "offers-list.normalized.json"), state.offers.listRows),
    writeJson(path.join(dirs.normalized, "offer-details-combined.json"), state.offers.combined),
    writeJson(path.join(dirs.normalized, "audiences-list.normalized.json"), state.audiences.listRows),
    writeJson(path.join(dirs.normalized, "audience-details-combined.json"), state.audiences.combined),
    writeCsv(path.join(dirs.csv, "activities_list.csv"), state.activities.listRows, ACTIVITIES_LIST_COLUMNS),
    writeCsv(path.join(dirs.csv, "activity_details_inventory.csv"), state.activities.detailRows, ACTIVITY_DETAILS_COLUMNS),
    writeCsv(path.join(dirs.csv, "offers_list.csv"), state.offers.listRows, OFFERS_LIST_COLUMNS),
    writeCsv(path.join(dirs.csv, "offer_details_inventory.csv"), state.offers.detailRows, OFFER_DETAILS_COLUMNS),
    writeCsv(path.join(dirs.csv, "audiences_list.csv"), state.audiences.listRows, AUDIENCES_LIST_COLUMNS),
    writeCsv(path.join(dirs.csv, "audience_details_inventory.csv"), state.audiences.detailRows, AUDIENCE_DETAILS_COLUMNS),
    writeJson(path.join(dirs.reports, "errors.json"), errors),
    writeJson(path.join(dirs.reports, "skipped-items.json"), skippedItems),
    writeJson(path.join(dirs.debug, "extraction-warnings.json"), extractionWarnings)
  ]);
}

function buildTargetHeaders(config, accessToken, { acceptHeader } = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "x-api-key": config.clientId,
    "x-gw-ims-org-id": config.orgId,
    Accept: acceptHeader || config.acceptHeader || DEFAULT_ACCEPT_HEADER,
    "Cache-Control": "no-cache"
  };
}

function buildTargetUrl(config, endpointPath, query = {}) {
  if (/^https?:\/\//i.test(String(endpointPath))) {
    return new URL(endpointPath);
  }

  const pathPart = String(endpointPath).startsWith("/") ? endpointPath : `/${endpointPath}`;
  const url = new URL(`${trimTrailingSlash(config.targetBaseUrl)}/${encodeURIComponent(config.tenant)}${pathPart}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

function resolveOfferDetailRoute(offer) {
  const offerId = offer.id ?? offer.offerId;
  const rawOfferType = offer.type ?? offer.offerType ?? offer.kind;
  if (!rawOfferType) return undefined;
  const offerType = normalizeOfferType(rawOfferType);
  const routeBuilder = OFFER_DETAIL_ROUTES[offerType];
  if (!offerId || !routeBuilder) return undefined;
  return {
    offerId,
    offerType,
    endpointPath: routeBuilder(offerId)
  };
}

function serializeInventoryError(error, config, item = {}) {
  return {
    section: item.section,
    itemId: item.itemId,
    itemType: item.itemType,
    itemName: item.itemName,
    status: error instanceof ApiError ? error.status : undefined,
    message: redactSecrets(error.message || String(error), config),
    url: error instanceof ApiError ? redactSecrets(error.url, config) : undefined,
    details: error instanceof ApiError ? redactSecrets(error.details, config) : undefined
  };
}

function redactSecrets(value, config = {}) {
  if (value === undefined || value === null) return value;

  if (typeof value === "string") {
    let redacted = value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/(client_secret=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(access_token=)[^&\s]+/gi, "$1[REDACTED]");

    for (const secret of [config.clientSecret].filter(Boolean)) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, config));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /authorization|access_token|client_secret/i.test(key) ? "[REDACTED]" : redactSecrets(child, config)
      ])
    );
  }

  return value;
}

function buildSummaryMarkdown({ runDir, startedAt, completedAt, state, errors, skippedItems, extractionWarnings }) {
  return `# Adobe Target Business Inventory Summary

- Run directory: ${runDir}
- Started: ${startedAt.toISOString()}
- Completed: ${completedAt.toISOString()}

## Primary CSV Rows

- activities_list.csv: ${state.activities.listRows.length}
- activity_details_inventory.csv: ${state.activities.detailRows.length}
- offers_list.csv: ${state.offers.listRows.length}
- offer_details_inventory.csv: ${state.offers.detailRows.length}
- audiences_list.csv: ${state.audiences.listRows.length}
- audience_details_inventory.csv: ${state.audiences.detailRows.length}

## Reports

- Errors: ${errors.length}
- Skipped items: ${skippedItems.length}
- Extraction warnings: ${extractionWarnings.length}

## Primary Grain

- Activity details: one row per activity + experience + optionLocation.
- Offer details: one row per offer detail response with safe metadata and content previews.
- Audience details: one row per meaningful targetRule condition.
`;
}

function createRunDirs(runDir) {
  const raw = path.join(runDir, "raw");
  return {
    runDir,
    raw,
    rawActivities: path.join(raw, "activities"),
    rawOffers: path.join(raw, "offers"),
    rawAudiences: path.join(raw, "audiences"),
    normalized: path.join(runDir, "normalized"),
    csv: path.join(runDir, "csv"),
    reports: path.join(runDir, "reports"),
    debug: path.join(runDir, "debug")
  };
}

function createEmptyInventoryState() {
  return {
    activities: {
      listItems: [],
      listRows: [],
      detailPackages: [],
      detailRows: [],
      combined: []
    },
    offers: {
      listItems: [],
      listRows: [],
      detailPackages: [],
      detailRows: [],
      combined: []
    },
    audiences: {
      listItems: [],
      listRows: [],
      detailPackages: [],
      detailRows: [],
      combined: []
    }
  };
}

function shouldRunScope(scope, section) {
  return scope === "all" || scope === section;
}

function normalizeScope(scope) {
  const value = String(scope || "all").toLowerCase();
  if (["all", "activities", "offers", "audiences"].includes(value)) return value;
  throw new Error(`Unsupported inventory scope: ${scope}`);
}

function parseTypedId(value, label) {
  const [type, id] = String(value ?? "").split(":", 2);
  if (!type || !id) {
    throw new Error(`Invalid ${label} argument. Expected type:id.`);
  }
  return { type: type.toLowerCase(), id };
}

function parseOfferArgument(value) {
  const text = String(value ?? "");
  if (text.includes(":")) {
    const [type, id] = text.split(":", 2);
    return { type: normalizeOfferType(type), id };
  }
  return { type: "content", id: text };
}

function getActivityIdentity(activity) {
  return {
    id: activity.id ?? activity.activityId,
    type: normalizeActivityType(activity.type ?? activity.activityType)
  };
}

function getResponseRoot(response) {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    if (response.activity && typeof response.activity === "object") return response.activity;
    if (response.offer && typeof response.offer === "object") return response.offer;
    if (response.audience && typeof response.audience === "object") return response.audience;
    if (response.data?.activity && typeof response.data.activity === "object") return response.data.activity;
    if (response.data?.offer && typeof response.data.offer === "object") return response.data.offer;
    if (response.data?.audience && typeof response.data.audience === "object") return response.data.audience;
    if (response.data && typeof response.data === "object" && !Array.isArray(response.data)) return response.data;
  }
  return response ?? {};
}

function normalizeActivityType(value) {
  return value === undefined || value === null ? undefined : String(value).toLowerCase();
}

function normalizeOfferType(value) {
  return String(value ?? "").toLowerCase();
}

function validateAuthConfig(config) {
  const missing = [];
  if (!config.clientId) missing.push("ADOBE_CLIENT_ID");
  if (!config.clientSecret) missing.push("ADOBE_CLIENT_SECRET");
  if (!config.scopes) missing.push("ADOBE_SCOPES");

  if (missing.length > 0) {
    throw new Error(`Missing required Adobe auth config: ${missing.join(", ")}`);
  }
}

function validateTargetConfig(config) {
  const missing = [];
  if (!config.orgId) missing.push("ADOBE_ORG_ID");
  if (!config.tenant) missing.push("ADOBE_TENANT");

  if (missing.length > 0) {
    throw new Error(`Missing required Adobe Target config: ${missing.join(", ")}`);
  }
}

function toPositiveInteger(primary, secondary, fallback) {
  for (const value of [primary, secondary]) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) return number;
  }
  return fallback;
}

function formatRunTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function printHelp() {
  console.log(`Adobe Target business inventory

Usage:
  node src/run-target-inventory.js [options]

Options:
  --scope all|activities|offers|audiences
  --out ./target-inventory-output
  --limit 100
  --concurrency 3
  --activity xt:323735
  --offer 858642
  --offer content:858642
  --audience 3683769
  --skip-details
  --no-workbook
  --help
`);
}

async function main() {
  const cliOptions = parseTargetInventoryCliArgs();
  if (cliOptions.help) {
    printHelp();
    return;
  }

  const result = await runTargetInventory(loadTargetInventoryConfig(cliOptions));
  console.log(`Business inventory written to ${result.runDir}`);
  console.log(`Primary CSV folder: ${result.csvDir}`);
  if (result.workbookFile) {
    console.log(`Workbook: ${result.workbookFile}`);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
