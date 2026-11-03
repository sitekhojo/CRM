// Login activity tracking (sign-ins + first app open per device per day).
import { supabase } from './supabase'

const ls = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}
const istDay = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)

export function deviceId() {
  let id = ls.get('sk_device_id')
  if (!id) { id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); ls.set('sk_device_id', id) }
  return id
}

export function deviceInfo(ua = navigator.userAgent) {
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'Phone' : 'Computer'
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Other'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return { device, browser: `${br} on ${os}` }
}

async function record(event) {
  const { device, browser } = deviceInfo()
  await supabase.from('login_events').insert({ event, device_id: deviceId(), device, browser, member_hint: ls.get('sk_visit_member') || null })
}

/** Call after a successful sign-in. */
export const logSignIn = () => { ls.set('sk_open_day', istDay()); return record('sign_in').catch(() => {}) }

/** Call when the app loads with a session: records the first open of the day on this device. */
export function logOpen() {
  if (ls.get('sk_open_day') === istDay()) return
  ls.set('sk_open_day', istDay())
  record('open').catch(() => {})
}
