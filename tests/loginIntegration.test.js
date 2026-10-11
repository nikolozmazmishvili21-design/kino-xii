import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { connectProfileBrowser } from "./helpers/profileBrowser.js";

const endpoint = process.env.KINO_PROFILE_QA_CDP_URL;
const rendered = (name, run) => test(name, { skip: !endpoint && "Requires disposable intercepted Chrome" }, run);
const user = { id: 12, username: "Login Fixture", email: "person@example.test", avatar: null, profileComplete: true,
  fullName: "Fixture Person", mobileNumber: "599123456", dateOfBirth: "1990-01-01", age: 36, preferredVenue: null };
const filters = { venues: [], genres: [], formats: [], languages: [], timeBands: [], sorts: [], ageRatings: [],
  ticketTypes: [{ id: 1, slug: "adult", name: "Adult", priceRatio: 1 }], maxSeatsPerOrder: 3 };
let server, origin, assets;
before(async () => {
  if (!endpoint) return;
  if (process.env.KINO_NOTIFY_QA_ASSETS) assets = JSON.parse(await readFile(process.env.KINO_NOTIFY_QA_ASSETS, "utf8"));
  server = await createServer({ cacheDir: "node_modules/.cache/kino-login-vite", server: { host: "127.0.0.1", port: 0 } });
  await server.listen(); origin = new URL(server.resolvedUrls.local[0]);
});
after(async () => { await server?.close(); });

async function fixture() {
  const browser = await connectProfileBrowser(endpoint, { commandTimeoutMs: 15000 });
  const calls = { login: [], forbidden: [], exceptions: [] }, tasks = new Set(), errors = [];
  let closing = false;
  const fulfill = (event, body, status = 200, type = "application/json") => browser.send("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status, responseHeaders: [
      { name: "Content-Type", value: type }, { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ], body: status === 204 ? "" : Buffer.from(body).toString("base64"),
  });
  const json = (event, body, status = 200) => fulfill(event, JSON.stringify(body), status);
  browser.on("Runtime.exceptionThrown", event => calls.exceptions.push(event.exceptionDetails.text));
  browser.on("Fetch.requestPaused", event => {
    if (closing) return;
    const task = (async () => {
      const url = new URL(event.request.url), method = event.request.method;
      if (url.origin === origin.origin) return browser.send("Fetch.continueRequest", { requestId: event.requestId });
      const asset = assets?.[event.request.url];
      if (asset) return fulfill(event, Buffer.from(asset.base64, "base64"), 200, asset.contentType);
      if (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return json(event, null, 204);
      if (url.hostname === "api.kinoxii.redberryinternship.ge") {
        if (method === "OPTIONS") return json(event, null, 204);
        if (method === "GET" && url.pathname === "/api/filter-options") return json(event, { data: filters });
        if (method === "GET" && url.pathname === "/api/me") return json(event, { data: user });
        if (method === "GET" && url.pathname === "/api/sessions") return json(event, { data: [], meta: {
          currentPage: 1, lastPage: 1, perPage: 10, totalMovies: 0, totalSessions: 0 } });
        if (method === "GET" && /^\/api\/movies\/(featured|now-playing|coming-soon)$/.test(url.pathname)) return json(event, { data: [] });
        if (method === "POST" && url.pathname === "/api/login") { calls.login.push(event); return; }
      }
      calls.forbidden.push({ method, path: url.pathname });
      return browser.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
    })().catch(error => errors.push(error)).finally(() => tasks.delete(task));
    tasks.add(task);
  });
  const settle = () => browser.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const close = async () => {
    closing = true; await Promise.all([...tasks]); await browser.close();
    assert.deepEqual(errors, []); assert.deepEqual(calls.forbidden, []); assert.deepEqual(calls.exceptions, []);
  };
  const open = async () => {
    await browser.evaluate("document.querySelector('.navbar__actions .button--secondary').click()");
    await browser.wait("document.querySelector('.auth-modal--login[open]')");
  };
  try {
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear();" });
    await browser.send("Page.navigate", { url: new URL("sessions", origin).href });
    await browser.send("Page.bringToFront");
    await browser.wait("document.querySelector('.navbar__actions .button--secondary')");
    await open(); await browser.evaluate("document.fonts.ready"); await settle();
  } catch (error) { await close(); throw error; }
  return { browser, calls, close, open, settle,
    async attempt() {
      const point = await browser.evaluate("(()=>{const r=document.querySelector('.auth-form__submit').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
      await settle();
    },
    async edit(name, value) {
      await browser.evaluate(`(() => {const input=document.querySelector('.auth-modal [name=${JSON.stringify(name)}]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await settle();
    },
    async submit() {
      const expected = calls.login.length + 1;
      await browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()"); await settle();
      const deadline = Date.now() + 10000;
      while (calls.login.length < expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(calls.login.length, expected);
    },
    async respond(status = 401, body = { message: "Invalid credentials." }) {
      assert.ok(calls.login.length); await json(calls.login.at(-1), body, status); await settle();
      await browser.wait("!document.querySelector('.auth-modal form[aria-busy=true]')");
    },
    async networkFailure() {
      assert.ok(calls.login.length);
      await browser.send("Fetch.failRequest", { requestId: calls.login.at(-1).requestId, errorReason: "Failed" });
      await browser.wait("!document.querySelector('.auth-modal form[aria-busy=true]')"); await settle();
    },
    async field(name) {
      return browser.evaluate(`(() => {const input=document.querySelector('.auth-modal [name=${JSON.stringify(name)}]'),field=input.closest('.form-field'),img=field.querySelector('.form-field__icon img'),css=getComputedStyle(input),rect=e=>e?.getBoundingClientRect().toJSON();return {
        state:field.className,invalid:input.getAttribute('aria-invalid'),described:input.getAttribute('aria-describedby'),
        description:(input.getAttribute('aria-describedby')||'').split(' ').filter(Boolean).map(id=>document.getElementById(id)?.textContent).join(' '),
        icon:img?true:null,iconColors:img?.src.startsWith('data:image/svg+xml,')?[...new Set([...decodeURIComponent(img.src.split(',')[1]).matchAll(/fill=['"]([^'"]+)/g)].map(m=>m[1]))]:[],loaded:img?img.complete&&img.naturalWidth>0:false,iconAlt:img?.alt,decorative:img?.parentElement.getAttribute('aria-hidden'),
        input:rect(input),slot:rect(img?.parentElement),image:rect(img),border:css.borderColor,color:css.color,background:css.backgroundColor,
        paddingRight:css.paddingRight,fontSize:css.fontSize,fontWeight:css.fontWeight,lineHeight:css.lineHeight,
        autofilled:input.matches(':autofill'),textFill:css.webkitTextFillColor,shadow:css.boxShadow,radius:css.borderRadius,backgroundClip:css.backgroundClip,
        errorBox:rect(field.querySelector('.form-field__error')),errorColor:field.querySelector('.form-field__error')&&getComputedStyle(field.querySelector('.form-field__error')).color,
        error:field.querySelector('.form-field__error')?.textContent??null,labelColor:getComputedStyle(field.querySelector('label')).color,
        type:input.type,readOnly:input.readOnly};})()`);
    },
    async capture(name) {
      const { data } = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const directory = process.env.KINO_AUTH_QA_CAPTURE_DIR || "node_modules/.cache/kino-login-ui";
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/${name}.png`, Buffer.from(data, "base64"));
    },
    async autofillEmail(value) {
      await browser.send("DOM.enable");
      await browser.send("CSS.enable");
      await browser.send("Autofill.enable");
      const { root } = await browser.send("DOM.getDocument");
      const { nodeId } = await browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".auth-modal [name=email]" });
      const { node } = await browser.send("DOM.describeNode", { nodeId });
      await browser.send("Autofill.trigger", { fieldId: node.backendNodeId, address: {
        fields: [{ name: "EMAIL_ADDRESS", value }, { name: "NAME_FULL", value: "Auth Fixture" }],
      } });
      await browser.wait(`document.querySelector('.auth-modal [name=email]').value === ${JSON.stringify(value)}`);
      await settle();
      const rules = await browser.send("CSS.getMatchedStylesForNode", { nodeId });
      return rules.matchedCSSRules.filter(({ rule }) => /autofill/.test(rule.selectorList.text))
        .map(({ rule }) => ({ origin: rule.origin, selector: rule.selectorList.text, properties: rule.style.cssProperties }));
    },
  };
}

async function valid(h) { await h.edit("email", user.email); await h.edit("password", "123"); }
async function rejected(h) { await valid(h); await h.submit(); await h.respond(); }
function success(field) {
  assert.match(field.state, /form-field--success/); assert.equal(field.invalid, null);
  assert.deepEqual(field.iconColors, ["none", "#4ADE80"]); assert.equal(field.loaded, true);
  assert.equal(field.iconAlt, ""); assert.equal(field.decorative, "true");
  assert.equal(field.slot.width, 16); assert.equal(field.slot.height, 16);
  // Intrinsic SVG dimensions and flex layout each quantize to 1/64 px.
  assert.ok(Math.abs(field.image.width - 15.9991) < 2 / 64);
  assert.ok(Math.abs(field.image.height - 16.0011) < 2 / 64);
  assert.equal(field.input.right - field.slot.right, 16); assert.equal(field.slot.top - field.input.top, 12);
  assert.equal(field.color, "rgb(255, 255, 255)"); assert.equal(field.labelColor, "rgb(255, 255, 255)");
  assert.equal(field.background, "rgb(30, 32, 49)"); assert.equal(field.border, "rgba(0, 0, 0, 0)");
  assert.equal(field.paddingRight, "40px"); assert.equal(field.fontSize, "12px"); assert.equal(field.fontWeight, "600");
}
function neutral(field) {
  assert.equal(field.state, "form-field"); assert.equal(field.icon, null);
  assert.equal(field.invalid, null); assert.equal(field.error, null); assert.equal(field.described, null);
}
function invalid(field, message) {
  assert.match(field.state, /form-field--error/); assert.doesNotMatch(field.state, /form-field--success/);
  assert.equal(field.invalid, "true"); assert.deepEqual(field.iconColors, ["none", "#EC3013"]); assert.equal(field.loaded, true);
  assert.equal(field.border, "rgb(236, 48, 19)"); assert.equal(field.labelColor, "rgb(236, 48, 19)");
  assert.equal(field.color, "rgb(236, 48, 19)"); assert.equal(field.background, "rgb(30, 32, 49)");
  assert.equal(field.iconAlt, ""); assert.equal(field.decorative, "true");
  assert.equal(field.slot.width, 16); assert.equal(field.slot.height, 16);
  assert.equal(field.image.width, 12); assert.equal(field.image.height, 12);
  assert.equal(field.input.right - field.slot.right, 16); assert.equal(field.slot.top - field.input.top, 12);
  assert.equal(field.image.x - field.slot.x, 2); assert.equal(field.image.y - field.slot.y, 2);
  assert.equal(field.paddingRight, "40px"); assert.equal(field.errorColor, "rgb(236, 48, 19)");
  assert.equal(field.errorBox.top - field.input.bottom, 8); assert.equal(field.lineHeight, "13px");
  assert.equal(field.error, message);
  assert.ok(field.described);
}

async function generalRejection(h, message = "Invalid credentials.") {
  neutral(await h.field("email")); neutral(await h.field("password"));
  const ui = await h.browser.evaluate(`(() => {
    const alert=document.querySelector('.auth-modal [role=alert]'),img=alert?.querySelector('img'),slot=img?.parentElement;
    return {alerts:document.querySelectorAll('.auth-modal [role=alert]').length,text:alert?.textContent.trim(),
      icons:document.querySelectorAll('.auth-modal .auth-form__error-icon').length,fieldIcons:document.querySelectorAll('.auth-modal .form-field__icon').length,
      loaded:img?.complete&&img.naturalWidth>0,alt:img?.alt,hidden:slot?.getAttribute('aria-hidden'),
      slotWidth:slot?.getBoundingClientRect().width,slotHeight:slot?.getBoundingClientRect().height,
      glyphWidth:img?.getBoundingClientRect().width,glyphHeight:img?.getBoundingClientRect().height,
      colors:img?.src.startsWith('data:image/svg+xml,')?[...new Set([...decodeURIComponent(img.src.split(',')[1]).matchAll(/fill=['"]([^'"]+)/g)].map(m=>m[1]))]:[],
      color:alert&&getComputedStyle(alert).color,modalWidth:document.querySelector('.auth-modal').getBoundingClientRect().width};
  })()`);
  assert.deepEqual(ui, { alerts:1,text:message,icons:1,fieldIcons:0,loaded:true,alt:"",hidden:"true",
    slotWidth:16,slotHeight:16,glyphWidth:12,glyphHeight:12,colors:["none","#EC3013"],color:"rgb(236, 48, 19)",modalWidth:403 });
  assert.equal(await h.browser.evaluate(`(() => {
    const modal=document.querySelector('.auth-modal'),bounds=modal.getBoundingClientRect();
    const controls=[...modal.querySelectorAll('input,button,[role=alert]')];
    const alert=modal.querySelector('[role=alert]').getBoundingClientRect();
    return controls.every(el=>{const r=el.getBoundingClientRect();return r.left>=bounds.left&&r.right<=bounds.right&&r.top>=bounds.top&&r.bottom<=bounds.bottom})
      && alert.bottom<=modal.querySelector('[type=submit]').getBoundingClientRect().top
      && modal.scrollWidth===modal.clientWidth && modal.scrollHeight===modal.clientHeight;
  })()`), true, "401 alert and controls must fit without clipping or overlap");
}

rendered("Login neutral state preserves modal geometry, labels, focus and masked password without status icons", async () => {
  const h = await fixture();
  try {
    for (const name of ["email", "password"]) {
      neutral(await h.field(name));
    }
    const ui = await h.browser.evaluate("(()=>{const d=document.querySelector('.auth-modal'),r=d.getBoundingClientRect();return {width:r.width,height:r.height,emailFocus:document.activeElement.name==='email',labels:[...d.querySelectorAll('label')].every(l=>document.getElementById(l.htmlFor)),submit:d.querySelector('[type=submit]').disabled,toggles:d.querySelectorAll('[aria-label*=\"Show password\"],[aria-label*=\"Hide password\"]').length}})()");
    assert.deepEqual(ui, { width: 403, height: 399, emailFocus: true, labels: true, submit: false, toggles: 0 });
    assert.equal((await h.field("password")).type, "password"); await h.capture("neutral");
    await h.attempt(); invalid(await h.field("email"), "Email is required"); invalid(await h.field("password"), "Password is required");
    assert.equal(h.calls.login.length, 0);
  } finally { await h.close(); }
});

for (const validValues of [true, false]) rendered(`Login ${validValues ? "valid" : "invalid"} typing and blur stay neutral before an explicit submit`, async () => {
  const h = await fixture();
  try {
    await h.edit("email", validValues ? user.email : "invalid"); neutral(await h.field("email"));
    assert.equal(await h.browser.evaluate("document.activeElement.name"), "email");
    await h.edit("password", validValues ? "123" : "12");
    neutral(await h.field("email")); neutral(await h.field("password"));
    await h.browser.evaluate("document.querySelector('.auth-form__submit').focus()"); await h.settle();
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(h.calls.login.length, 0); await h.capture(validValues ? "filled-before-submit" : "invalid-before-submit");
  } finally { await h.close(); }
});

for (const name of ["email", "password"]) rendered(`Login explicit submit shows the existing ${name} validation and edits reset both fields`, async () => {
  const h = await fixture();
  try {
    await h.edit("email", name === "email" ? "invalid" : user.email);
    await h.edit("password", name === "password" ? "12" : "123");
    neutral(await h.field("email")); neutral(await h.field("password"));
    await h.attempt();
    invalid(await h.field(name), name === "email" ? "Please enter a valid email address" : "Password must be at least 3 characters");
    success(await h.field(name === "email" ? "password" : "email"));
    assert.equal(await h.browser.evaluate("document.activeElement.name"), name);
    assert.equal(h.calls.login.length, 0);
    await h.capture(`${name}-local-error`);
    await valid(h); neutral(await h.field("email")); neutral(await h.field("password"));
    await h.submit(); neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal((await h.field("password")).type, "password"); await h.capture("filled"); await h.respond();
  } finally { await h.close(); }
});

for (const message of ["Invalid credentials.", "Unable to sign in with these credentials. Please check your details and try again."]) rendered(`Login 401 keeps both fields neutral and announces the exact general rejection: ${message}`, async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit(); await h.respond(401, { message }); await generalRejection(h, message);
    assert.equal((await h.field("password")).description, "");
    const ui = await h.browser.evaluate("({open:document.querySelector('.auth-modal').open,email:document.querySelector('[name=email]').value,alerts:[...document.querySelectorAll('.auth-modal [role=alert]')].map(e=>e.textContent),message:document.querySelector('.auth-modal').textContent})");
    assert.equal(ui.open, true); assert.equal(ui.email, user.email); assert.deepEqual(ui.alerts.map(text=>text.trim()), [message]);
    assert.equal(await h.browser.evaluate("document.querySelector('[name=password]').value"), "123");
    assert.doesNotMatch(ui.message, /Wrong password|Email is correct|Email does not exist|Password is incorrect/);
    await h.capture("rejected");
  } finally { await h.close(); }
});

for (const name of ["email", "password"]) rendered(`Login editing ${name} after 401 resets indicators until a fresh explicit submit`, async () => {
  const h = await fixture();
  try {
    await rejected(h); await h.edit(name, name === "email" ? "changed@example.test" : "456");
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal((await h.field("password")).described, null);
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
    await h.edit(name, name === "email" ? "bad" : "1");
    neutral(await h.field("email")); neutral(await h.field("password"));
    await h.attempt(); invalid(await h.field(name), name === "email" ? "Please enter a valid email address" : "Password must be at least 3 characters");
    assert.equal(h.calls.login.length, 1);
    await h.edit(name, name === "email" ? "changed@example.test" : "456");
    neutral(await h.field("email")); neutral(await h.field("password"));
    await h.submit(); neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(h.calls.login.length, 2); await h.respond(); await generalRejection(h);
  } finally { await h.close(); }
});

rendered("Login pending requests keep fields read-only, prevent duplicates and cannot reject a newer edited draft", async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit();
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal((await h.field("email")).readOnly, true); assert.equal((await h.field("password")).readOnly, true);
    await h.edit("email", "ignored@example.test");
    await h.browser.evaluate("document.querySelector('.auth-modal form').requestSubmit();document.querySelector('.auth-modal form').requestSubmit()");
    assert.equal(h.calls.login.length, 1);
    await h.respond();
    assert.equal(await h.browser.evaluate("document.querySelector('[name=email]').value"), user.email);
    await h.edit("email", "new@example.test"); neutral(await h.field("email")); neutral(await h.field("password"));
    await h.settle(); assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
  } finally { await h.close(); }
});

rendered("Login late 401 from a dismissed form cannot mark a reopened form rejected", async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit(); await h.browser.evaluate("document.querySelector('.auth-modal__close').click()");
    await h.open(); await h.respond();
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
    assert.equal((await h.field("password")).icon, null);
    await h.edit("email", "new@example.test"); neutral(await h.field("email"));
    assert.equal((await h.field("password")).icon, null);
  } finally { await h.close(); }
});

rendered("Login switching to Sign Up while pending ignores a late 401 and preserves neutral new form", async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit();
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--signup')");
    await h.respond();
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
    assert.equal(h.calls.login.length, 1);
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--login')");
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
  } finally { await h.close(); }
});

rendered("Login successful synthetic authentication preserves payload, session adoption and modal close", async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit();
    assert.equal(new URL(h.calls.login[0].request.url).pathname, "/api/login");
    assert.equal(h.calls.login[0].request.method, "POST");
    assert.deepEqual(JSON.parse(h.calls.login[0].request.postData), { email: user.email, password: "123" });
    assert.equal(new Headers(h.calls.login[0].request.headers).has("Authorization"), false);
    await h.respond(200, { data: { user, token: "synthetic-login-token" } });
    await h.browser.wait("!document.querySelector('.auth-modal') && document.querySelector('.profile-dropdown__toggle')");
    assert.equal(await h.browser.evaluate("location.pathname"), "/sessions");
    assert.equal(await h.browser.evaluate("localStorage.getItem('kino-xii.auth.token')==='synthetic-login-token'"), true);
  } finally { await h.close(); }
});

for (const failure of ["429", "500", "network"]) rendered(`Login ${failure} failure keeps credentials neutral and editing requires fresh local validation`, async () => {
  const h = await fixture();
  try {
    await valid(h); await h.submit();
    neutral(await h.field("email")); neutral(await h.field("password"));
    if (failure === "429") await h.respond(429, { message: "Too many attempts. Please try again later." });
    else if (failure === "500") await h.respond(500, { message: "Server unavailable." });
    else await h.networkFailure();
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal').open"), true);
    assert.equal(await h.browser.evaluate("document.querySelector('[role=alert]').textContent.trim()"), failure === "429" ? "Too many attempts. Please try again later." : "Unable to log in right now. Please try again.");
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error-icon')"), null);
    await h.capture(`${failure}-failure`);
    await h.edit("password", "12");
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
    await h.attempt(); success(await h.field("email")); invalid(await h.field("password"), "Password must be at least 3 characters");
    assert.equal(h.calls.login.length, 1);
    await h.edit("password", "456"); await h.submit();
    neutral(await h.field("email")); neutral(await h.field("password"));
    assert.equal(h.calls.login.length, 2); await h.respond();
    await generalRejection(h);
  } finally { await h.close(); }
});

rendered("Login 422 field errors retain focus/description and message-only 422 never becomes a credentials rejection", async () => {
  for (const fieldError of ["email", "password", null]) {
    const h = await fixture();
    try {
      await valid(h); await h.submit();
      await h.respond(422, fieldError ? { message: "Invalid input", errors: { [fieldError]: ["Server field validation"] } } : { message: "Sign in is unavailable." });
      if (fieldError) {
        invalid(await h.field(fieldError), "Server field validation");
        neutral(await h.field(fieldError === "email" ? "password" : "email"));
        assert.equal(await h.browser.evaluate("document.activeElement.name"), fieldError);
        assert.equal((await h.field(fieldError)).description, "Server field validation");
      } else {
        neutral(await h.field("email"));
        neutral(await h.field("password"));
        assert.equal(await h.browser.evaluate("document.querySelector('[role=alert]').textContent.trim()"), "Sign in is unavailable.");
      }
      await h.edit(fieldError || "email", fieldError === "password" ? "456" : "changed@example.test");
      neutral(await h.field("email")); neutral(await h.field("password"));
      assert.equal(await h.browser.evaluate("document.querySelector('.auth-form__error')"), null);
    } finally { await h.close(); }
  }
});

rendered("Registration shares the green success check and red error icon without changing validation timing", async () => {
  const h = await fixture();
  try {
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--signup')");
    assert.equal(await h.browser.evaluate("document.querySelector('.auth-modal').getBoundingClientRect().width"), 475);
    await h.edit("email", user.email); assert.equal((await h.field("email")).icon, null);
    await h.edit("password", "123");
    success(await h.field("email"));
    await h.capture("signup-valid-email");
    await h.edit("password_confirmation", "different");
    await h.browser.evaluate("document.querySelector('.auth-modal form').requestSubmit()"); await h.settle();
    invalid(await h.field("password_confirmation"), "Passwords must match");
    assert.equal(h.calls.login.length, 0);
    await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
    await h.browser.wait("document.querySelector('.auth-modal--login')");
    assert.equal((await h.field("email")).icon, null); assert.equal((await h.field("password")).icon, null);
  } finally { await h.close(); }
});

for (const method of ["close", "escape", "backdrop"]) rendered(`Login ${method} dismissal remains usable without submitting`, async () => {
  const h = await fixture();
  try {
    await valid(h);
    if (method === "close") await h.browser.evaluate("document.querySelector('.auth-modal__close').click()");
    if (method === "escape") {
      await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
    if (method === "backdrop") {
      await h.browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 1, y: 1, button: "left", clickCount: 1 });
      await h.browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 1, y: 1, button: "left", clickCount: 1 });
    }
    await h.browser.wait("!document.querySelector('.auth-modal')"); assert.equal(h.calls.login.length, 0);
  } finally { await h.close(); }
});

for (const mode of ["login", "signup"]) rendered(`${mode} real Chrome email autofill preserves dark fill, text, focus and validation states`, async () => {
  const h = await fixture();
  try {
    if (mode === "signup") {
      await h.browser.evaluate("document.querySelector('.auth-form__switch button').click()");
      await h.browser.wait("document.querySelector('.auth-modal--signup')");
    }
    const rules = await h.autofillEmail("unregistered@example.test");
    const filled = await h.field("email");
    await h.capture(`${mode}-autofill`);
    if (process.env.KINO_AUTH_QA_CAPTURE_DIR) await writeFile(`${process.env.KINO_AUTH_QA_CAPTURE_DIR}/${mode}-autofill-styles.json`, JSON.stringify({ filled, rules }, null, 2));
    assert.equal(filled.autofilled, true, "Chrome itself must populate the field and set :autofill");
    // Chrome's !important UA background remains underneath the opaque inset.
    assert.equal(filled.shadow, "rgb(30, 32, 49) 0px 0px 0px 1000px inset");
    assert.equal(filled.textFill, "rgb(255, 255, 255)");
    assert.equal(filled.radius, "12px");
    assert.equal(filled.input.height, 40);
    assert.equal(h.calls.login.length, 0, "Email format/autofill must not check account existence");
    assert.equal(filled.backgroundClip, "padding-box");
    // Autofill can populate Signup's username too, leaving initial focus there.
    // Email feedback still waits for actual email engagement and blur.
    await h.browser.evaluate("document.querySelector('.auth-modal [name=email]').focus()");
    await h.edit("password", "12");
    if (mode === "login") await h.attempt();
    const checked = await h.field("email");
    assert.equal(checked.autofilled, true);
    assert.match(checked.state, /form-field--success/);
    assert.deepEqual(checked.iconColors, ["none", "#4ADE80"]);
    assert.equal(checked.textFill, "rgb(255, 255, 255)");
    assert.equal(checked.paddingRight, "40px");
    await h.capture(`${mode}-autofill-success`);
    assert.equal(h.calls.login.length, 0);
  } finally { await h.close(); }
});

for (const email of [user.email, "unregistered@example.test"]) rendered(`Login format checks cannot establish account existence: ${email}`, async () => {
  const h = await fixture();
  try {
    await h.edit("email", email); await h.edit("password", "12");
    await h.attempt(); success(await h.field("email"));
    invalid(await h.field("password"), "Password must be at least 3 characters");
    assert.equal(h.calls.login.length, 0);
    await h.edit("password", "123"); await h.submit(); await h.respond();
    await generalRejection(h);
    assert.equal(await h.browser.evaluate("document.querySelector('[name=email]').value"), email);
    assert.equal(await h.browser.evaluate("document.querySelector('[name=password]').value"), "123");
    await h.settle(); assert.equal(h.calls.login.length, 1, "401 must not trigger an authentication replay");
  } finally { await h.close(); }
});

rendered("Login autofilled 422 email error stays red and associated, then a 401 stays general", async () => {
  const h = await fixture();
  try {
    await h.autofillEmail(user.email); await h.edit("password", "123"); await h.submit();
    await h.respond(422, { message: "The given data was invalid.", errors: { email: ["Server email validation"] } });
    const field = await h.field("email");
    assert.equal(field.autofilled, true); assert.equal(field.invalid, "true");
    assert.equal(field.description, "Server email validation");
    assert.deepEqual(field.iconColors, ["none", "#EC3013"]);
    assert.equal(field.textFill, "rgb(236, 48, 19)");
    assert.equal(field.border, "rgb(236, 48, 19)");
    assert.equal(field.shadow, "rgb(30, 32, 49) 0px 0px 0px 1000px inset");
    await h.capture("login-autofill-422");
    await h.submit(); await h.respond(); await generalRejection(h);
    assert.equal((await h.field("email")).textFill, "rgb(255, 255, 255)");
    await h.capture("login-autofill-401");
    assert.equal(h.calls.login.length, 2);
  } finally { await h.close(); }
});

rendered("Login real keyboard typing, Tab focus and focus wrapping remain usable", async () => {
  const h = await fixture();
  const tab = async () => {
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await h.browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await h.settle();
  };
  try {
    await h.browser.send("Input.insertText", { text: "unregistered@example.test" });
    await tab(); assert.equal(await h.browser.evaluate("document.activeElement.name"), "password");
    await h.browser.send("Input.insertText", { text: "123" }); await h.settle();
    neutral(await h.field("email")); neutral(await h.field("password"));
    const focus = await h.browser.evaluate("({visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineWidth,style:getComputedStyle(document.activeElement).outlineStyle})");
    assert.deepEqual(focus, { visible: true, outline: "2px", style: "solid" });
    assert.equal((await h.field("email")).autofilled, false);
    assert.equal((await h.field("email")).background, "rgb(30, 32, 49)");
    await h.capture("login-keyboard-typing");
    for (const selector of [".auth-form__submit", ".auth-form__switch button", ".auth-modal__close", "[name=email]"]) {
      await tab(); assert.equal(await h.browser.evaluate(`document.activeElement.matches(${JSON.stringify(selector)})`), true);
    }
    assert.equal(h.calls.login.length, 0);
  } finally { await h.close(); }
});
