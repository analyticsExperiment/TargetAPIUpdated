export const ACTIVITIES_LIST_COLUMNS = [
  "activity_id",
  "activity_type",
  "activity_name",
  "activity_state",
  "activity_priority",
  "activity_modified_at"
];

export const ACTIVITY_DETAILS_COLUMNS = [
  "activity_id",
  "activity_type",
  "activity_name",
  "activity_state",
  "activity_priority",
  "activity_reporting_source",
  "experience_name",
  "experience_audience_ids",
  "experience_option_location_type",
  "experience_option_location_name",
  "experience_option_location_audience_ids",
  "experience_option_offer_id",
  "experience_option_offer_name",
  "experience_option_offer_additionalDetails",
  "reporting_metric_name",
  "reporting_conversion",
  "metric_action_type",
  "analytics_company_name",
  "analytics_report_suite"
];

export const OFFERS_LIST_COLUMNS = ["offer_id", "offer_name", "offer_type", "offer_modified_at"];

export const OFFER_DETAILS_COLUMNS = [
  "offer_id",
  "offer_name",
  "offer_type",
  "offer_modified_at",
  "offer_detail_endpoint_used",
  "content_available",
  "content_format",
  "content_character_count",
  "contains_html",
  "contains_script",
  "contains_css",
  "contains_image_url",
  "contains_external_url",
  "image_urls",
  "external_urls",
  "script_count",
  "css_selector_references",
  "content_preview",
  "raw_offer_file"
];

export const AUDIENCES_LIST_COLUMNS = [
  "audience_id",
  "audience_name",
  "audience_description",
  "audience_origin",
  "audience_modified_at"
];

export const AUDIENCE_DETAILS_COLUMNS = [
  "audience_id",
  "audience_name",
  "audience_description",
  "audience_origin",
  "audience_modified_at",
  "rule_path",
  "rule_depth",
  "parent_operator",
  "condition_sequence",
  "condition_source_type",
  "condition_source_name",
  "match_operator",
  "match_values",
  "condition_readable",
  "raw_condition_json",
  "raw_audience_file"
];

const SOURCE_KEYS = [
  "mbox",
  "profile",
  "page",
  "parameter",
  "geo",
  "browser",
  "traffic",
  "audience",
  "segment"
];

const MATCH_OPERATOR_KEYS = [
  "containsIgnoreCase",
  "contains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "matches",
  "exists",
  "doesNotExist",
  "greaterThan",
  "lessThan",
  "in",
  "notIn"
];

const GROUP_KEYS = ["or", "and", "not"];

export function buildActivitiesListRows(activities = []) {
  return toArray(activities).map((activity) =>
    orderRow(
      {
        activity_id: activity?.id,
        activity_type: activity?.type,
        activity_name: activity?.name,
        activity_state: activity?.state,
        activity_priority: activity?.priority,
        activity_modified_at: activity?.modifiedAt
      },
      ACTIVITIES_LIST_COLUMNS
    )
  );
}

export function buildActivityDetailsRows(activityPackage, { warnings = [] } = {}) {
  const activity = getResponseRoot(activityPackage?.detail);
  const metrics = summarizeMetrics(activity);
  const locationByLocalId = buildLocationLookup(activity);
  const optionByLocalId = buildOptionLookup(activity);
  const rows = [];
  const experiences = toArray(activity.experiences).filter(isObject);

  if (experiences.length === 0) {
    warnings.push({
      type: "activity_experiences_missing",
      activityId: activity.id ?? activity.activityId,
      activityName: activity.name ?? activity.activityName
    });
    return rows;
  }

  for (const [experienceIndex, experience] of experiences.entries()) {
    const optionLocations = toArray(experience.optionLocations).filter(isObject);

    if (optionLocations.length === 0) {
      warnings.push({
        type: "activity_experience_option_locations_missing",
        activityId: activity.id ?? activity.activityId,
        activityName: activity.name ?? activity.activityName,
        experienceIndex,
        experienceName: experience.name ?? experience.experienceName
      });
      continue;
    }

    for (const [optionLocationIndex, optionLocation] of optionLocations.entries()) {

      const locationLocalId = optionLocation.locationLocalId;
      const optionLocalId = optionLocation.optionLocalId;
      const location = lookupByLocalId(locationByLocalId, locationLocalId);
      const option = lookupByLocalId(optionByLocalId, optionLocalId);

      if (!location) {
        warnings.push({
          type: "activity_location_lookup_failed",
          activityId: activity.id ?? activity.activityId,
          activityName: activity.name ?? activity.activityName,
          experienceIndex,
          experienceName: experience.name ?? experience.experienceName,
          optionLocationIndex,
          locationLocalId,
          optionLocalId
        });
      }

      if (!option) {
        warnings.push({
          type: "activity_option_lookup_failed",
          activityId: activity.id ?? activity.activityId,
          activityName: activity.name ?? activity.activityName,
          experienceIndex,
          experienceName: experience.name ?? experience.experienceName,
          optionLocationIndex,
          locationLocalId,
          optionLocalId
        });
      }

      rows.push(
        orderRow(
          {
            activity_id: activity.id ?? activity.activityId,
            activity_type: normalizeActivityType(activity.type ?? activity.activityType),
            activity_name: activity.name ?? activity.activityName,
            activity_state: activity.state ?? activity.status,
            activity_priority: activity.priority,
            activity_reporting_source: activity.reportingSource ?? activity.reportSource,
            experience_name: experience.name ?? experience.experienceName,
            experience_audience_ids: joinValuesOrDash(experience.audienceIds),
            experience_option_location_type: location?.__locationType ?? "",
            experience_option_location_name: location ? formatLocationName(location) : "",
            experience_option_location_audience_ids: location ? joinValuesOrDash(location.audienceIds) : "-",
            experience_option_offer_id: option ? option.offerId ?? option.id ?? "" : "",
            experience_option_offer_name: option ? option.name ?? option.offerName ?? findMetadataOfferName(option) ?? "" : "",
            experience_option_offer_additionalDetails: option ? stringifyOfferTemplates(option) : "-",
            reporting_metric_name: metrics.names,
            reporting_conversion: metrics.conversions,
            metric_action_type: metrics.actionTypes,
            analytics_company_name: metrics.analyticsCompanyNames,
            analytics_report_suite: metrics.analyticsReportSuites
          },
          ACTIVITY_DETAILS_COLUMNS
        )
      );
    }
  }

  return rows;
}

export function buildActivityDetailsCombined(activityPackages, { warnings = [] } = {}) {
  return toArray(activityPackages).map((activityPackage) => {
    const activity = getResponseRoot(activityPackage?.detail);
    return {
      activity: {
        id: activity.id ?? activity.activityId,
        type: normalizeActivityType(activity.type ?? activity.activityType),
        name: activity.name ?? activity.activityName,
        state: activity.state ?? activity.status,
        priority: activity.priority,
        reportingSource: activity.reportingSource,
        modifiedAt: activity.modifiedAt
      },
      options: toArray(activity.options ?? activity.offers),
      locations: activity.locations ?? {},
      experiences: toArray(activity.experiences),
      metrics: toArray(activity.metrics),
      reportingConfig: {
        reportingSource: activity.reportingSource,
        analytics: activity.analytics
      },
      derivedMappings: buildActivityDetailsRows(activityPackage, { warnings }),
      rawFile: activityPackage?.rawFile,
      errors: activityPackage?.error ? [activityPackage.error] : []
    };
  });
}

export function buildOffersListRows(offers = []) {
  return toArray(offers).map((offer) =>
    orderRow(
      {
        offer_id: offer?.id,
        offer_name: offer?.name,
        offer_type: offer?.type,
        offer_modified_at: offer?.modifiedAt
      },
      OFFERS_LIST_COLUMNS
    )
  );
}

export function buildOfferDetailsRows(offerPackages = []) {
  return toArray(offerPackages).map((offerPackage) => {
    const listItem = offerPackage?.listItem ?? {};
    const detail = getResponseRoot(offerPackage?.detail) ?? {};
    const contentSummary = summarizeOfferContent(detail);

    return orderRow(
      {
        offer_id: detail.id ?? listItem.id,
        offer_name: detail.name ?? listItem.name,
        offer_type: detail.type ?? listItem.type,
        offer_modified_at: detail.modifiedAt ?? listItem.modifiedAt,
        offer_detail_endpoint_used: offerPackage?.endpointPath,
        content_available: contentSummary.contentAvailable,
        content_format: contentSummary.contentFormat,
        content_character_count: contentSummary.contentCharacterCount,
        contains_html: contentSummary.containsHtml,
        contains_script: contentSummary.containsScript,
        contains_css: contentSummary.containsCss,
        contains_image_url: contentSummary.containsImageUrl,
        contains_external_url: contentSummary.containsExternalUrl,
        image_urls: joinValues(contentSummary.imageUrls),
        external_urls: joinValues(contentSummary.externalUrls),
        script_count: contentSummary.scriptCount,
        css_selector_references: joinValues(contentSummary.cssSelectorReferences),
        content_preview: contentSummary.contentPreview,
        raw_offer_file: offerPackage?.rawFile
      },
      OFFER_DETAILS_COLUMNS
    );
  });
}

export function buildOfferDetailsCombined(offerPackages = []) {
  return toArray(offerPackages).map((offerPackage) => {
    const listItem = offerPackage?.listItem ?? {};
    const detail = getResponseRoot(offerPackage?.detail) ?? {};
    const contentSummary = summarizeOfferContent(detail);

    return {
      listMetadata: listItem,
      detailMetadata: {
        id: detail.id ?? listItem.id,
        name: detail.name ?? listItem.name,
        type: detail.type ?? listItem.type,
        modifiedAt: detail.modifiedAt ?? listItem.modifiedAt
      },
      contentSummary,
      extractedUrls: {
        imageUrls: contentSummary.imageUrls,
        externalUrls: contentSummary.externalUrls
      },
      extractedSelectors: contentSummary.cssSelectorReferences,
      detailEndpointUsed: offerPackage?.endpointPath,
      rawFile: offerPackage?.rawFile,
      errors: offerPackage?.error ? [offerPackage.error] : []
    };
  });
}

export function buildAudiencesListRows(audiences = []) {
  return toArray(audiences).map((audience) =>
    orderRow(
      {
        audience_id: audience?.id,
        audience_name: audience?.name,
        audience_description: audience?.description,
        audience_origin: audience?.origin,
        audience_modified_at: audience?.modifiedAt
      },
      AUDIENCES_LIST_COLUMNS
    )
  );
}

export function buildAudienceDetailsRows(audiencePackages = []) {
  const rows = [];

  for (const audiencePackage of toArray(audiencePackages)) {
    const listItem = audiencePackage?.listItem ?? {};
    const detail = getResponseRoot(audiencePackage?.detail) ?? {};
    const conditions = extractAudienceConditions(detail);
    const metadata = {
      audience_id: detail.id ?? listItem.id,
      audience_name: detail.name ?? listItem.name,
      audience_description: detail.description ?? listItem.description,
      audience_origin: detail.origin ?? listItem.origin,
      audience_modified_at: detail.modifiedAt ?? listItem.modifiedAt
    };

    conditions.forEach((condition, index) => {
      rows.push(
        orderRow(
          {
            ...metadata,
            ...condition,
            condition_sequence: index + 1,
            raw_audience_file: audiencePackage?.rawFile
          },
          AUDIENCE_DETAILS_COLUMNS
        )
      );
    });
  }

  return rows;
}

export function buildAudienceDetailsCombined(audiencePackages = []) {
  return toArray(audiencePackages).map((audiencePackage) => {
    const listItem = audiencePackage?.listItem ?? {};
    const detail = getResponseRoot(audiencePackage?.detail) ?? {};
    const flattenedConditions = buildAudienceDetailsRows([audiencePackage]);

    return {
      audience: {
        id: detail.id ?? listItem.id,
        name: detail.name ?? listItem.name,
        description: detail.description ?? listItem.description,
        origin: detail.origin ?? listItem.origin,
        modifiedAt: detail.modifiedAt ?? listItem.modifiedAt
      },
      targetRule: detail.targetRule,
      flattenedConditions,
      conditionCount: flattenedConditions.length,
      rawFile: audiencePackage?.rawFile,
      errors: audiencePackage?.error ? [audiencePackage.error] : []
    };
  });
}

export function extractAudienceConditions(audienceDetail) {
  const detail = getResponseRoot(audienceDetail) ?? {};
  const targetRule = detail.targetRule;
  const rows = [];

  if (targetRule === undefined || targetRule === null) {
    return rows;
  }

  walkRule(targetRule, {
    path: "targetRule",
    depth: 0,
    parentOperator: "UNKNOWN",
    rows
  });

  return rows.map((row, index) => ({ ...row, condition_sequence: index + 1 }));
}

export async function collectDetailItemsWithErrors({
  items,
  fetchDetail,
  buildPackage,
  buildError,
  concurrency = 3,
  onProgress
}) {
  const packages = [];
  const errors = [];
  const indexedResults = new Array(toArray(items).length);
  let nextIndex = 0;
  const sourceItems = toArray(items);
  const workerCount = Math.min(Math.max(Number(concurrency) || 1, 1), sourceItems.length || 1);

  async function worker() {
    while (nextIndex < sourceItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = sourceItems[currentIndex];

      try {
        const detail = await fetchDetail(item, currentIndex);
        indexedResults[currentIndex] = {
          ok: true,
          value: buildPackage({ item, detail, index: currentIndex })
        };
        onProgress?.({ index: currentIndex, item, ok: true });
      } catch (error) {
        indexedResults[currentIndex] = {
          ok: false,
          value: buildError({ item, error, index: currentIndex })
        };
        onProgress?.({ index: currentIndex, item, ok: false, error });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const result of indexedResults) {
    if (!result) continue;
    if (result.ok) packages.push(result.value);
    else errors.push(result.value);
  }

  return { packages, errors };
}

export function summarizeOfferContent(detail) {
  const contentValue = findMainContent(detail);
  const contentString = contentValue === undefined ? "" : stringifyContent(contentValue);
  const normalizedContent = normalizeWhitespace(contentString);
  const externalUrls = unique(extractUrls(contentString));
  const imageUrls = unique(externalUrls.filter(isImageUrl));
  const cssSelectorReferences = unique([...findCssSelectorFields(detail), ...findSelectorStrings(contentString)]);
  const scriptTagCount = countMatches(contentString, /<script\b/gi);
  const containsScript = hasScriptSignal(contentString);
  const containsHtml = hasHtmlSignal(contentString);
  const containsCss = hasCssSignal(contentString) || cssSelectorReferences.length > 0;
  const contentFormat = detectContentFormat(contentValue, contentString, detail);

  return {
    contentAvailable: contentValue !== undefined && contentString !== "",
    contentFormat,
    contentCharacterCount: contentString.length,
    containsHtml,
    containsScript,
    containsCss,
    containsImageUrl: imageUrls.length > 0,
    containsExternalUrl: externalUrls.length > 0,
    imageUrls,
    externalUrls,
    scriptCount: scriptTagCount > 0 ? scriptTagCount : containsScript ? 1 : 0,
    cssSelectorReferences,
    contentPreview: normalizedContent.slice(0, 500)
  };
}

function buildLocationLookup(activity) {
  const lookup = new Map();
  const locationGroups = [
    { type: "mbox", rows: toArray(activity?.locations?.mboxes) },
    { type: "selector", rows: toArray(activity?.locations?.selectors) },
    { type: "decisionScope", rows: toArray(activity?.locations?.decisionScopes) },
    { type: "decisionScope", rows: toArray(activity?.locations?.scopes) }
  ];

  for (const group of locationGroups) {
    for (const location of group.rows) {
      if (!isObject(location)) continue;
      const indexedLocation = { ...location, __locationType: group.type };
      [
        location.locationLocalId,
        location.localId,
        location.id,
        location.name,
        location.mboxName,
        location.decisionScope,
        location.scope
      ].forEach((candidate) => addLookupCandidate(lookup, candidate, indexedLocation));
    }
  }

  return lookup;
}

function buildOptionLookup(activity) {
  const lookup = new Map();

  for (const option of toArray(activity?.options ?? activity?.offers)) {
    if (!isObject(option)) continue;
    addOptionLookupCandidates(lookup, option);
  }

  if (Array.isArray(activity?.options) && Array.isArray(activity?.offers)) {
    for (const option of activity.offers) {
      if (!isObject(option)) continue;
      addOptionLookupCandidates(lookup, option);
    }
  }

  return lookup;
}

function addOptionLookupCandidates(lookup, option) {
  [
    option.optionLocalId,
    option.offerLocalId,
    option.localId,
    option.optionId,
    option.id
  ].forEach((candidate) => addLookupCandidate(lookup, candidate, option));
}

function addLookupCandidate(lookup, value, item) {
  if (value === undefined || value === null || value === "") return;
  const key = String(value);
  if (!lookup.has(key)) lookup.set(key, item);
}

function lookupByLocalId(lookup, value) {
  if (value === undefined || value === null) return undefined;
  return lookup.get(String(value));
}

function formatLocationName(location) {
  if (location.__locationType === "selector") {
    if (location.name && location.selector) return `${location.name} - ${location.selector}`;
    return location.selector ?? location.name ?? "";
  }

  if (location.__locationType === "decisionScope") {
    const scope = location.decisionScope ?? location.scope;
    if (location.name && scope) return `${location.name}-${scope}`;
    return scope ?? location.name ?? "";
  }

  return location.name ?? location.mboxName ?? location.mbox ?? "";
}

function summarizeMetrics(activity) {
  const metrics = toArray(activity?.metrics).filter(isObject);
  const metricReportSuites = metrics.flatMap((metric) => [
    ...flattenReportSuiteValues(metric.analytics?.reportSuite),
    ...flattenReportSuiteValues(metric.analytics?.reportSuites)
  ]);
  const activityReportSuites = [
    ...flattenReportSuiteValues(activity?.analytics?.reportSuite),
    ...flattenReportSuiteValues(activity?.analytics?.reportSuites),
    ...flattenReportSuiteValues(activity?.analytics?.rsid)
  ];

  return {
    names: joinUnique(metrics.map((metric) => metric.name ?? metric.metricName)),
    conversions: joinUnique(metrics.map((metric) => metric.conversion)),
    actionTypes: joinUnique(metrics.map((metric) => metric.action?.type ?? metric.actionType)),
    analyticsCompanyNames: joinUnique(metrics.map((metric) => metric.analytics?.companyName)),
    analyticsReportSuites: joinUnique([...metricReportSuites, ...activityReportSuites])
  };
}

function flattenReportSuiteValues(value) {
  return toArray(value).flatMap((item) => {
    if (Array.isArray(item)) return flattenReportSuiteValues(item);
    if (isObject(item)) {
      return [
        ...flattenReportSuiteValues(item.reportSuite),
        ...flattenReportSuiteValues(item.reportSuites),
        ...flattenReportSuiteValues(item.rsid)
      ];
    }
    return item === undefined || item === null || item === "" ? [] : [item];
  });
}

function findMetadataOfferName(option) {
  if (option?.metadata?.name) return option.metadata.name;

  for (const template of toArray(option?.offerTemplates ?? option?.templates)) {
    for (const parameter of toArray(template?.templateParameters ?? template?.parameters)) {
      if (!isObject(parameter)) continue;
      const parsed = parseMaybeJson(parameter.value);
      if (parsed?.metadata?.name) return parsed.metadata.name;
    }
  }

  return undefined;
}

function stringifyOfferTemplates(option) {
  return Array.isArray(option?.offerTemplates) && option.offerTemplates.length > 0
    ? JSON.stringify(option.offerTemplates, null, 2)
    : "-";
}

function walkRule(node, { path, depth, parentOperator, rows }) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      walkRule(item, { path: `${path}[${index}]`, depth, parentOperator, rows });
    });
    return;
  }

  if (!isObject(node)) {
    return;
  }

  if (isAudienceCondition(node)) {
    rows.push(buildAudienceConditionRow(node, { path, depth, parentOperator }));
  }

  for (const groupKey of GROUP_KEYS) {
    if (!(groupKey in node)) continue;
    const value = node[groupKey];
    const nextOperator = groupKey.toUpperCase();
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walkRule(item, {
          path: `${path}.${groupKey}[${index}]`,
          depth: depth + 1,
          parentOperator: nextOperator,
          rows
        });
      });
    } else if (isObject(value)) {
      walkRule(value, {
        path: `${path}.${groupKey}`,
        depth: depth + 1,
        parentOperator: nextOperator,
        rows
      });
    }
  }
}

function buildAudienceConditionRow(condition, { path, depth, parentOperator }) {
  const source = detectConditionSource(condition);
  const match = detectMatchOperator(condition);
  const matchValues = match ? stringifyValueList(match.value) : "";
  const sourceName = stringifyConditionSource(source.value);
  const readableParts = [source.type, sourceName, match?.operator ?? "unknown", matchValues].filter((part) => part !== "");

  return {
    rule_path: path,
    rule_depth: depth,
    parent_operator: parentOperator,
    condition_source_type: source.type,
    condition_source_name: sourceName,
    match_operator: match?.operator ?? "unknown",
    match_values: matchValues,
    condition_readable: readableParts.join(" "),
    raw_condition_json: stringifyJson(condition)
  };
}

function isAudienceCondition(value) {
  return (
    isObject(value) &&
    (SOURCE_KEYS.some((key) => key in value) || MATCH_OPERATOR_KEYS.some((key) => key in value))
  );
}

function detectConditionSource(condition) {
  for (const key of SOURCE_KEYS) {
    if (key in condition) {
      return {
        type: key,
        value: condition[key]
      };
    }
  }

  const fallback = Object.keys(condition).find(
    (key) => !GROUP_KEYS.includes(key) && !MATCH_OPERATOR_KEYS.includes(key)
  );

  return {
    type: fallback ? "unknown" : "unknown",
    value: fallback ? condition[fallback] : ""
  };
}

function detectMatchOperator(condition) {
  for (const key of MATCH_OPERATOR_KEYS) {
    if (key in condition) {
      return {
        operator: key,
        value: condition[key]
      };
    }
  }

  return undefined;
}

function findMainContent(detail) {
  const direct = pickFirstDeep(detail, ["content", "body", "html", "text", "json", "url"]);
  if (direct !== undefined) return direct;
  return undefined;
}

function detectContentFormat(contentValue, contentString, detail) {
  const typeText = String(detail?.type ?? detail?.offerType ?? detail?.contentType ?? detail?.format ?? "").toLowerCase();
  const trimmed = contentString.trim();

  if (!trimmed) return "unknown";
  if (isImageUrl(trimmed) || typeText.includes("image")) return "image";
  if (typeText.includes("redirect")) return "redirect";
  if (typeof contentValue !== "string" || parseMaybeJson(trimmed)) return "json";
  if (hasHtmlSignal(trimmed)) return "html";
  if (hasScriptSignal(trimmed)) return "javascript";
  return "text";
}

function hasHtmlSignal(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value ?? ""));
}

function hasScriptSignal(value) {
  const text = String(value ?? "");
  return /<script\b/i.test(text) || /function\s*\(/i.test(text) || /addEventListener\s*\(/i.test(text) ||
    /_satellite\b/i.test(text) || /\balloy\s*\(/i.test(text) || /adobe\.target\b/i.test(text);
}

function hasCssSignal(value) {
  const text = String(value ?? "");
  return /<style\b/i.test(text) || /\bstyle\s*=/i.test(text) || /[.#]?[A-Za-z0-9_-]+\s*\{[^}]*[A-Za-z-]+\s*:/i.test(text);
}

function findCssSelectorFields(value) {
  const selectors = [];
  walkJson(value, ({ key, value: child, parent }) => {
    if (/^cssSelector$/i.test(String(key)) && child !== undefined && child !== null) {
      selectors.push(String(child));
    }

    if (
      isObject(parent) &&
      /^name$/i.test(String(key)) &&
      /^cssSelector$/i.test(String(child ?? "")) &&
      parent.value !== undefined &&
      parent.value !== null
    ) {
      selectors.push(String(parent.value));
    }
  });
  return selectors;
}

function findSelectorStrings(content) {
  const selectors = [];
  const text = String(content ?? "");
  const patterns = [
    /\$\(\s*["']([^"']+)["']\s*\)/g,
    /querySelector(?:All)?\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      selectors.push(match[1]);
    }
  }

  return selectors;
}

function extractUrls(value) {
  const text = String(value ?? "");
  const matches = text.match(/https?:\/\/[^\s"'<>),]+/gi);
  return matches ?? [];
}

function isImageUrl(value) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i.test(String(value ?? ""));
}

function pickFirstDeep(value, keys) {
  let found;
  walkJson(value, ({ key, value: child }) => {
    if (found !== undefined) return;
    if (keys.some((candidate) => candidate.toLowerCase() === String(key).toLowerCase())) {
      found = child;
    }
  });
  return found;
}

function walkJson(value, visitor, path = "$", parent = undefined, seen = new WeakSet()) {
  if (!isObject(value) && !Array.isArray(value)) return;
  if (isObject(value) || Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitor({ key: index, value: item, path: `${path}[${index}]`, parent });
      walkJson(item, visitor, `${path}[${index}]`, value, seen);
    });
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    const childPath = `${path}.${key}`;
    visitor({ key, value: child, path: childPath, parent: value });
    walkJson(child, visitor, childPath, value, seen);
  });
}

function getResponseRoot(response) {
  if (isObject(response?.activity)) return response.activity;
  if (isObject(response?.offer)) return response.offer;
  if (isObject(response?.audience)) return response.audience;
  if (isObject(response?.data?.activity)) return response.data.activity;
  if (isObject(response?.data?.offer)) return response.data.offer;
  if (isObject(response?.data?.audience)) return response.data.audience;
  if (isObject(response?.data)) return response.data;
  return response ?? {};
}

function orderRow(row, columns) {
  return Object.fromEntries(columns.map((column) => [column, blankIfMissing(row[column])]));
}

function blankIfMissing(value) {
  return value === undefined || value === null ? "" : value;
}

function normalizeActivityType(value) {
  return value === undefined || value === null ? "" : String(value).toLowerCase();
}

function joinUnique(values) {
  return joinValues(unique(toArray(values).flatMap((value) => toArray(value)).filter((value) => value !== undefined && value !== null && value !== "")));
}

function joinValues(values) {
  return toArray(values)
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map((value) => (isObject(value) || Array.isArray(value) ? stringifyJson(value) : String(value)))
    .join(",");
}

function joinValuesOrDash(values) {
  const joined = joinValues(values);
  return joined === "" ? "-" : joined;
}

function unique(values) {
  return Array.from(new Set(toArray(values).filter((value) => value !== undefined && value !== null && value !== "")));
}

function stringifyValueList(value) {
  if (Array.isArray(value)) return joinValues(value);
  if (isObject(value)) return stringifyJson(value);
  return value === undefined || value === null ? "" : String(value);
}

function stringifyConditionSource(value) {
  if (isObject(value)) {
    return value.name ?? value.id ?? value.key ?? stringifyJson(value);
  }
  return value === undefined || value === null ? "" : String(value);
}

function stringifyContent(value) {
  if (typeof value === "string") return value;
  return stringifyJson(value);
}

function stringifyJson(value) {
  return JSON.stringify(value);
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return isObject(value) || Array.isArray(value) ? value : undefined;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function countMatches(value, pattern) {
  return String(value ?? "").match(pattern)?.length ?? 0;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
