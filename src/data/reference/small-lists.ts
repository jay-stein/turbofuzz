/** Short closed lists: currencies, regions, calendar words. Loaded on demand. */
export interface ReferenceList {
  names: string[];
  aliases: Record<string, string>;
}

const split = (text: string): string[] => text.split("|");

/** ISO 4217 alphabetic codes in common use. */
const CURRENCIES = split(
  "AED|AFN|ALL|AMD|ANG|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BGN|BHD|BIF|BMD|BND|BOB|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHF|CLP|CNY|COP|CRC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|UYU|UZS|VES|VND|VUV|WST|XAF|XCD|XOF|XPF|YER|ZAR|ZMW|ZWL",
);

const AU_STATES = split("NSW|VIC|QLD|WA|SA|TAS|ACT|NT|New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|Australian Capital Territory|Northern Territory");

const US_STATES = split(
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia",
);

const WEEKDAYS = split("Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun");
const MONTHS = split("January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec");

export const currencies: ReferenceList = { names: CURRENCIES, aliases: {} };
export const auStates: ReferenceList = { names: AU_STATES, aliases: {} };
export const usStates: ReferenceList = { names: US_STATES, aliases: {} };
export const weekdays: ReferenceList = { names: WEEKDAYS, aliases: {} };
export const months: ReferenceList = { names: MONTHS, aliases: {} };

/** [code, long name] pairs: each state list holds its codes, then the names in the same order. */
function codeNamePairs(list: readonly string[]): [string, string][] {
  const half = list.length / 2;
  return list.slice(0, half).map((code, i) => [code, list[half + i]!]);
}

/** Code and long name of each state, so "New South Wales" can be offered as NSW (and back). */
export const stateForms: Readonly<Record<"auState" | "usState", readonly [string, string][]>> = {
  auState: codeNamePairs(AU_STATES),
  usState: codeNamePairs(US_STATES),
};
