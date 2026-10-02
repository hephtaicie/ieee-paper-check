// SPDX-License-Identifier: MIT
import type { Config } from "@ieee-check/core";
import { DEFAULT_CONFIG } from "@ieee-check/core";
import siteConfig from "../site-config.json";
import type { MailTemplate } from "./mail-template.ts";

/** Public deployment defaults shared by the author and admin pages. */
export const SITE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  ...siteConfig,
  disabledChecks: (siteConfig.disabledChecks ??
    DEFAULT_CONFIG.disabledChecks) as Config["disabledChecks"],
};

export function sharedSiteConfig(): Config {
  return { ...SITE_CONFIG, disabledChecks: [...SITE_CONFIG.disabledChecks] };
}

export const SITE_EMAIL_TEMPLATE: MailTemplate = siteConfig.emailTemplate;
