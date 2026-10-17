//! F1 TV login for the live timing feed.
//!
//! F1 sends `Position.z` (car positions) and `CarData.z` (car telemetry) only to a connection that
//! carries an F1 TV subscription token; on the public feed those topics stay silent. The token
//! lives in the `login-session` cookie formula1.com sets at sign-in, saved to the file named by
//! `F1_LOGIN_SESSION_FILE` (a bare token also works). The file is re-read on every connection, so
//! a refreshed login is picked up at the next reconnect without restarting anything.

use std::{
    env, fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use percent_encoding::percent_decode_str;
use serde::Deserialize;
use tracing::{info, warn};

const LOGIN_SESSION_FILE_VAR: &str = "F1_LOGIN_SESSION_FILE";
const EXPIRY_WARNING_SECS: u64 = 24 * 60 * 60;
const SECS_PER_HOUR: u64 = 60 * 60;

#[derive(Deserialize)]
struct LoginSession {
    data: LoginSessionData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginSessionData {
    subscription_token: String,
}

#[derive(Deserialize)]
struct TokenClaims {
    exp: u64,
}

/// The subscription token to connect with, or `None` to stay on the public feed.
///
/// An expired token is never sent: F1 would refuse the whole connection, and the public feed
/// still carries the timing tower.
pub fn subscription_token() -> Option<String> {
    let Some(path) = env::var_os(LOGIN_SESSION_FILE_VAR) else {
        info!(
            "{LOGIN_SESSION_FILE_VAR} not set, using the public feed (no car positions or telemetry)"
        );
        return None;
    };

    let token = match read_token(Path::new(&path)) {
        Ok(token) => token,
        Err(err) => {
            warn!(?err, "could not read the F1 login, using the public feed");
            return None;
        }
    };

    match seconds_until_expiry(&token) {
        Some(0) => {
            warn!(
                "F1 login has expired: sign in at formula1.com and save it again; using the public feed"
            );
            None
        }
        Some(left) if left < EXPIRY_WARNING_SECS => {
            warn!(
                hours_left = left / SECS_PER_HOUR,
                "F1 login expires soon: sign in at formula1.com and save it again"
            );
            Some(token)
        }
        Some(left) => {
            info!(
                hours_left = left / SECS_PER_HOUR,
                "connecting with the F1 TV login"
            );
            Some(token)
        }
        None => {
            warn!("F1 login has no readable expiry, trying it anyway");
            Some(token)
        }
    }
}

fn read_token(path: &Path) -> Result<String, anyhow::Error> {
    let saved = fs::read_to_string(path)?;
    let saved = saved.trim();

    if saved.starts_with("eyJ") {
        return Ok(saved.to_string());
    }

    let cookie = percent_decode_str(saved).decode_utf8()?;
    let session: LoginSession = serde_json::from_str(&cookie)?;
    Ok(session.data.subscription_token)
}

fn seconds_until_expiry(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let claims: TokenClaims =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).ok()?).ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(claims.exp.saturating_sub(now))
}
