use crate::error::{AppError, AppResult};

const EARTH_RADIUS_KM: f64 = 6371.0;

/// Validate that latitude and longitude are finite and within WGS84 bounds.
pub fn validate_coordinates(lat: f64, lng: f64, label: &str) -> AppResult<()> {
    if !lat.is_finite() || !(-90.0..=90.0).contains(&lat) {
        return Err(AppError::bad_request(format!(
            "Invalid {label} latitude {lat}: must be between -90.0 and 90.0"
        )));
    }
    if !lng.is_finite() || !(-180.0..=180.0).contains(&lng) {
        return Err(AppError::bad_request(format!(
            "Invalid {label} longitude {lng}: must be between -180.0 and 180.0"
        )));
    }
    Ok(())
}

/// Compute great-circle Haversine distance in kilometers between two WGS84 coordinates.
pub fn haversine_distance_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let lat1_rad = lat1.to_radians();
    let lat2_rad = lat2.to_radians();
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();

    let sin_dlat = (dlat / 2.0).sin();
    let sin_dlng = (dlng / 2.0).sin();

    let a = sin_dlat * sin_dlat + lat1_rad.cos() * lat2_rad.cos() * sin_dlng * sin_dlng;
    let c = 2.0 * a.clamp(0.0, 1.0).sqrt().atan2((1.0 - a).clamp(0.0, 1.0).sqrt());
    EARTH_RADIUS_KM * c
}

/// Evaluate Layer 1 geofence: returns `(is_on_site, distance_km)` when both user coordinates are provided.
pub fn evaluate_on_site(
    user_lat: Option<f64>,
    user_lng: Option<f64>,
    post_lat: f64,
    post_lng: f64,
    radius_km: f64,
) -> AppResult<(bool, Option<f64>)> {
    if let Some(ulat) = user_lat {
        if !ulat.is_finite() || !(-90.0..=90.0).contains(&ulat) {
            return Err(AppError::bad_request(format!(
                "Invalid user_lat {ulat}: must be between -90.0 and 90.0"
            )));
        }
    }
    if let Some(ulng) = user_lng {
        if !ulng.is_finite() || !(-180.0..=180.0).contains(&ulng) {
            return Err(AppError::bad_request(format!(
                "Invalid user_lng {ulng}: must be between -180.0 and 180.0"
            )));
        }
    }

    match (user_lat, user_lng) {
        (Some(ulat), Some(ulng)) => {
            let distance = haversine_distance_km(ulat, ulng, post_lat, post_lng);
            Ok((distance <= radius_km, Some(distance)))
        }
        _ => Ok((false, None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_coords_zero_distance() {
        let d = haversine_distance_km(6.8667, 81.0466, 6.8667, 81.0466);
        assert!(d < 1e-9);
    }

    #[test]
    fn colombo_to_gampaha_within_35km() {
        // Colombo Fort (6.9344, 79.8428) to Gampaha (7.0873, 79.9990) ~ 24.2 km
        let d = haversine_distance_km(6.9344, 79.8428, 7.0873, 79.9990);
        assert!(d > 20.0 && d < 30.0, "unexpected distance {d}");
    }

    #[test]
    fn geofence_boundary_15km() {
        // ~11.12 km north (0.1 degree latitude) -> inside 15 km
        let (inside, dist_in) =
            evaluate_on_site(Some(6.9667), Some(81.0466), 6.8667, 81.0466, 15.0).unwrap();
        assert!(inside);
        assert!(dist_in.unwrap() < 12.0);

        // ~22.2 km north (0.2 degree latitude) -> outside 15 km
        let (outside, dist_out) =
            evaluate_on_site(Some(7.0667), Some(81.0466), 6.8667, 81.0466, 15.0).unwrap();
        assert!(!outside);
        assert!(dist_out.unwrap() > 20.0);
    }

    #[test]
    fn missing_user_gps_not_on_site() {
        let (on_site, dist) = evaluate_on_site(None, None, 6.8667, 81.0466, 15.0).unwrap();
        assert!(!on_site);
        assert!(dist.is_none());
    }
}
