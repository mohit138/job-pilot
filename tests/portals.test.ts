import { describe, expect, test } from "bun:test"
import { detectFromUrl } from "../src/portals/detect.ts"
import { htmlToText, locationTerms, matchesLocation, matchesQuery, parseRelativePosted, daysAgo, titleCase } from "../src/portals/helpers.ts"
import { isAllowed, rulesFor } from "../src/portals/robots.ts"

describe("detectFromUrl", () => {
  test("workday with locale and job path", () => {
    expect(detectFromUrl("https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced/job/Noida/X_R1")).toEqual({
      ats: "workday",
      board: { host: "adobe.wd5.myworkdayjobs.com", tenant: "adobe", site: "external_experienced" },
      via: "url",
    })
  })
  test("oracle keeps locationId and label from the link", () => {
    const d = detectFromUrl(
      "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?location=Bengaluru%2C+Karnataka%2C+India&locationId=300000081145775"
    )
    expect(d?.ats).toBe("oracle")
    expect(d?.board).toEqual({
      host: "jpmc.fa.oraclecloud.com",
      siteNumber: "CX_1001",
      locationId: "300000081145775",
      locationLabel: "Bengaluru, Karnataka, India",
    })
  })
  test("greenhouse, lever, ashby", () => {
    expect(detectFromUrl("https://job-boards.greenhouse.io/stripe")?.board).toEqual({ token: "stripe" })
    expect(detectFromUrl("https://jobs.lever.co/spotify/abc")?.board).toEqual({ company: "spotify" })
    expect(detectFromUrl("https://jobs.ashbyhq.com/ashby")?.board).toEqual({ name: "ashby" })
  })
  test("unknown host returns null", () => {
    expect(detectFromUrl("https://careers.swiggy.in/explore-jobs")).toBeNull()
  })
})

describe("location + query matching", () => {
  test("city aliases", () => {
    expect(locationTerms("Bengaluru, Karnataka, India")).toContain("bangalore")
    expect(matchesLocation("India, Karnataka, Bangalore", "Bengaluru", false)).toBe(true)
    expect(matchesLocation("Hyderabad, India", "Bengaluru", false)).toBe(false)
    expect(matchesLocation("Remote - India", "Bengaluru", true)).toBe(true)
    expect(matchesLocation(null, "Bengaluru", false)).toBe(true)
  })
  test("query words must all be in title", () => {
    expect(matchesQuery("Senior Software Engineer", "software engineer")).toBe(true)
    expect(matchesQuery("Senior Software Engineer", "java")).toBe(false)
    expect(matchesQuery("Anything", undefined)).toBe(true)
  })
})

describe("dates + text", () => {
  test("workday relative dates", () => {
    expect(parseRelativePosted("Posted Today")).toBe(daysAgo(0))
    expect(parseRelativePosted("Posted 30+ Days Ago")).toBe(daysAgo(30))
    expect(parseRelativePosted("whenever")).toBeNull()
  })
  test("htmlToText decodes escaped html and keeps lists", () => {
    expect(htmlToText("&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;&lt;ul&gt;&lt;li&gt;one&lt;/li&gt;&lt;/ul&gt;")).toBe("Hi & bye\n\n- one")
  })
})

describe("robots", () => {
  const body = "User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /\nAllow: /api/pcsx\n"
  test("longest match wins for *", () => {
    const rules = rulesFor(body)
    expect(isAllowed(rules, "/api/pcsx/search")).toBe(true)
    expect(isAllowed(rules, "/v1/companies/x/postings")).toBe(false)
  })
  test("tie goes to disallow; wildcards", () => {
    expect(isAllowed(rulesFor("User-agent: *\nAllow: /a\nDisallow: /a\n"), "/a")).toBe(false)
    expect(isAllowed(rulesFor("User-agent: *\nDisallow: /*.json$\n"), "/api/jobs.json")).toBe(false)
  })
  test("agent groups match the job-pilot token exactly, any case; empty agent lines are ignored", () => {
    expect(isAllowed(rulesFor("User-agent: JOB-PILOT\nDisallow: /\n"), "/x")).toBe(false)
    // Substrings of our name are other bots: fall back to "*".
    expect(isAllowed(rulesFor("User-agent: pilot\nDisallow: /\nUser-agent: *\nAllow: /\n"), "/x")).toBe(true)
    expect(isAllowed(rulesFor("User-agent: job\nDisallow: /\n"), "/x")).toBe(true)
    expect(isAllowed(rulesFor("User-agent:\nUser-agent: *\nDisallow: /a\n"), "/a")).toBe(false)
  })
})

describe("remote roles and titles from slugs", () => {
  test("remote elsewhere is not remote in India", () => {
    expect(matchesLocation("Toronto, Vancouver, Canada-Remote", "Bengaluru", true)).toBe(false)
    expect(matchesLocation("Remote", "Bengaluru", true)).toBe(true)
    expect(matchesLocation("Remote - India", "Bengaluru", true)).toBe(true)
  })
  test("acronyms survive title-casing", () => {
    expect(titleCase("staff-software-engineer-ai-native-sre")).toBe("Staff Software Engineer AI Native SRE")
  })
})
