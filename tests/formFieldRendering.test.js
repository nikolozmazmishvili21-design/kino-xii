import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, FormField;
before(async () => {
  server = await createServer({ cacheDir: "node_modules/.cache/kino-form-field-rendering",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" });
  FormField = (await server.ssrLoadModule("/src/components/forms/FormField.jsx")).default;
});
after(async () => { await server?.close(); });

const render = (props) => renderToStaticMarkup(createElement(FormField, props));
const input = (html) => html.match(/<input\b[^>]*>/)[0];
const attribute = (html, name) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const icon = (html) => html.match(/<span class="form-field__icon"[^>]*><img[^>]*>/)?.[0];
const iconSvg = (html) => decodeURIComponent(attribute(icon(html), "src").split(",")[1]).replaceAll("&#x27;", '"');

test("a valid email uses the shared green success asset as a decorative trailing icon", () => {
  const html = render({ label: "Email", name: "email", type: "email", value: "person@example.test", readOnly: true, success: true });
  assert.match(html, /form-field--success/);
  assert.doesNotMatch(input(html), /aria-invalid/);
  assert.match(icon(html), /aria-hidden="true"/);
  assert.match(icon(html), /alt=""/);
  const svg = iconSvg(html);
  assert.match(svg, /width="15\.9991" height="16\.0011"/);
  assert.match(svg, /fill="#4ADE80"/);
  assert.doesNotMatch(svg, /fill="white"|fill="#EC3013"/);
});

test("an invalid password shows only the red error icon and associates every error message", () => {
  const errors = ["Password must be at least 3 characters", "Server password validation"];
  const html = render({ label: "Password", name: "password", type: "password", value: "12", readOnly: true, error: errors, success: true });
  assert.match(html, /form-field--error/);
  assert.doesNotMatch(html, /form-field--success/);
  assert.match(input(html), /aria-invalid="true"/);
  assert.match(iconSvg(html), /fill="#EC3013"/);
  assert.match(icon(html), /aria-hidden="true"/);
  assert.match(icon(html), /alt=""/);
  const errorId = attribute(input(html), "aria-describedby");
  assert.ok(errorId);
  assert.ok(html.includes(`class="form-field__error" id="${errorId}"`));
  for (const error of errors) assert.ok(html.includes(error));
  assert.equal((html.match(/class="form-field__icon"/g) ?? []).length, 1);
});

for (const value of ["", "person@example.test"]) test(`an untouched field has no validation icon (value: ${value || "empty"})`, () => {
  const html = render({ label: "Email", name: "email", type: "email", value, readOnly: true });
  assert.equal(icon(html), undefined);
  assert.doesNotMatch(html, /form-field--success|form-field--error|aria-invalid/);
  assert.equal(attribute(html.match(/<label\b[^>]*>/)[0], "for"), attribute(input(html), "id"));
});

test("shared input helpers and caller descriptions remain associated with field errors", () => {
  const html = render({ label: "Email", name: "email", helperText: "Email help", error: "Server email validation", "aria-describedby": "external-description" });
  const ids = attribute(input(html), "aria-describedby").split(" ");
  assert.equal(ids.length, 3);
  assert.equal(ids[2], "external-description");
  assert.ok(html.includes(`class="form-field__helper" id="${ids[0]}">Email help`));
  assert.ok(html.includes(`class="form-field__error" id="${ids[1]}"`));
});
