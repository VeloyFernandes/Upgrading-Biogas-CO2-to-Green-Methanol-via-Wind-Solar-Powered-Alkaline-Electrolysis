"""Regenerate docs/assets/data.js for the project website.

Re-runs the models from Wind_Solar_v24.ipynb (same parameters, same libraries)
and exports the hourly series and summary tables the web UI needs.

Usage:  python scripts/build_site_data.py [--cache DIR] [--skip-geo]

Requires: pvlib, windpowerlib, pandas, numpy, scipy, requests
NASA POWER responses are cached in the cache directory.
"""
import argparse
import json
import os
import sys
import time
import warnings

import numpy as np
import pandas as pd
import pvlib
import requests
from pvlib.temperature import TEMPERATURE_MODEL_PARAMETERS
from scipy.stats import weibull_min
from windpowerlib import TurbineClusterModelChain, WindFarm, WindTurbine

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------- parameters
# (identical to Chunk 1 of the notebook)
SOLAR_DC_MW = 304
DC_AC_RATIO = 1.25
LAT, LON, ALT = 55.03, 9.28, 10
TZ = "Europe/Copenhagen"
SITE_NAME = "Aabenraa Kasso"
MODULE = "Canadian_Solar_CS6X_300M__2013_"
INVERTER = "Yaskawa_Solectria_Solar__SGI_750XTM__380V_"
TEMP_MODEL = "open_rack_glass_polymer"
TILT, AZIMUTH = 50, 180
START, END = "2023-01-01", "2023-12-31"
START_C, END_C = "20230101", "20231231"

WIND_PARAMS = "T2M,PS,WS10M,WD10M,WS50M,T10M,WD50M"
SOLAR_PARAMS = "ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M"
ROUGHNESS = 0.15
HUB_HEIGHT = 130.0
HELLMAN = 0.15
TURBINE = "V90/3000"
ROTOR_D = 90.0
N_TURBINES = 20
SPACING_MAIN = 15   # main simulation (Chunk 3)
SPACING_GEO = 7     # geospatial comparison (Chunk 8)

ELECTROLYZER_MW = 53
METHANOL_MW = 2.0
UPTIME = 0.92

LOCATIONS = [
    ("Skagen", 57.72, 10.58), ("Copenhagen", 55.68, 12.57), ("Aarhus", 56.16, 10.21),
    ("Odense", 55.40, 10.39), ("Esbjerg", 55.47, 8.45), ("Aalborg", 57.05, 9.92),
    ("Rønne (Bornholm)", 55.10, 14.70), ("Aabenraa Kasso", 55.03, 9.28),
    ("Randers", 56.46, 10.04), ("Kolding", 55.49, 9.47), ("Horsens", 55.86, 9.85),
    ("Vejle", 55.71, 9.53), ("Roskilde", 55.64, 12.08), ("Herning", 56.14, 8.97),
    ("Silkeborg", 56.17, 9.55), ("Næstved", 55.23, 11.76), ("Fredericia", 55.57, 9.75),
    ("Viborg", 56.45, 9.40), ("Køge", 55.46, 12.18), ("Holstebro", 56.36, 8.62),
    ("Slagelse", 55.40, 11.35), ("Hillerød", 55.93, 12.31), ("Sønderborg", 54.91, 9.79),
    ("Svendborg", 55.06, 10.61), ("Hjørring", 57.46, 9.99), ("Frederikshavn", 57.44, 10.54),
    ("Nykøbing Falster", 54.77, 11.87), ("Helsingør (Elsinore)", 56.03, 12.61),
    ("Holbæk", 55.72, 11.71), ("Ringkøbing", 56.09, 8.24), ("Thisted", 56.95, 8.69),
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- NASA POWER
def nasa_power(lat, lon, params, cache_dir, tag):
    path = os.path.join(cache_dir, f"{tag}_{lat:.4f}_{lon:.4f}_{START_C}_{END_C}.json")
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    else:
        url = "https://power.larc.nasa.gov/api/temporal/hourly/point"
        q = dict(latitude=lat, longitude=lon, start=START_C, end=END_C,
                 parameters=params, community="RE", format="JSON")
        for attempt in range(5):
            try:
                r = requests.get(url, params=q, timeout=120)
                r.raise_for_status()
                data = r.json()
                break
            except Exception as e:  # noqa: BLE001
                log(f"  retry {attempt + 1} for {tag} {lat},{lon}: {e}")
                time.sleep(2 ** (attempt + 1))
        else:
            raise RuntimeError(f"NASA POWER fetch failed for {lat},{lon}")
        with open(path, "w") as f:
            json.dump(data, f)
        time.sleep(0.3)
    df = pd.DataFrame(data["properties"]["parameter"])
    df.index = pd.to_datetime(df.index, format="%Y%m%d%H", errors="coerce")
    df = df[pd.notna(df.index)]
    df.index = df.index.tz_localize("UTC")
    df = df.replace(-999.0, np.nan)
    for c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.ffill().bfill().fillna(0)


# ---------------------------------------------------------------- solar
class SolarDesign:
    def __init__(self, total_modules_target=None):
        self.module = pvlib.pvsystem.retrieve_sam("SandiaMod")[MODULE]
        self.inverter = pvlib.pvsystem.retrieve_sam("CECInverter")[INVERTER]
        self.temp = TEMPERATURE_MODEL_PARAMETERS["sapm"][TEMP_MODEL]
        m, inv = self.module, self.inverter
        self.paco = float(inv.Paco)
        self.p_mod = float(m.Vmpo * m.Impo)
        if total_modules_target is None:
            total_modules_target = SOLAR_DC_MW * 1e6 / self.p_mod
        mps = int(min(np.floor(inv.Vdcmax / m.Voco), np.floor(inv.Mppt_high / m.Vmpo)))
        mps = max(mps, int(np.ceil(inv.Mppt_low / m.Vmpo)))
        self.modules_per_string = mps
        target_mod_per_inv = self.paco * DC_AC_RATIO / self.p_mod
        self.strings_per_inverter = int(np.ceil(target_mod_per_inv / mps))
        self.modules_per_inverter = mps * self.strings_per_inverter
        self.num_inverters = int(np.ceil(total_modules_target / self.modules_per_inverter))
        self.total_modules = self.num_inverters * self.modules_per_inverter
        self.dc_mw = self.total_modules * self.p_mod / 1e6
        self.ac_mw = self.num_inverters * self.paco / 1e6

    def chain(self, lat, lon, tilt=TILT, azimuth=AZIMUTH):
        loc = pvlib.location.Location(lat, lon, tz=TZ, altitude=ALT)
        system = pvlib.pvsystem.PVSystem(
            surface_tilt=tilt, surface_azimuth=azimuth,
            module_parameters=self.module, inverter_parameters=self.inverter,
            temperature_model_parameters=self.temp,
            modules_per_string=self.modules_per_string,
            strings_per_inverter=self.strings_per_inverter)
        return pvlib.modelchain.ModelChain(system, loc), loc

    def farm_mw(self, mc):
        return mc.results.ac.clip(lower=0, upper=self.paco).fillna(0) * self.num_inverters / 1e6


def clear_sky_weather(loc, freq):
    end = (pd.to_datetime(END) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    times = pd.date_range(START, end, freq=freq, tz=loc.tz, inclusive="left")
    cs = loc.get_clearsky(times)
    cs["temp_air"] = 20.0
    cs["wind_speed"] = 1.0
    return cs


# ---------------------------------------------------------------- wind
def wind_weather(df):
    """Notebook Chunk 3 pre-processing -> windpowerlib weather frame."""
    df = df.copy()
    df["roughness_length"] = ROUGHNESS
    ws10 = df["WS10M"].replace(0, np.nan)
    ws50 = df["WS50M"].replace(0, np.nan)
    ratio = (ws50 / ws10).replace([np.inf, -np.inf], np.nan)
    alpha = pd.Series(np.nan, index=df.index)
    ok = ratio.dropna().index[ratio.dropna() > 0]
    alpha.loc[ok] = np.log(ratio.loc[ok]) / np.log(50.0 / 10.0)
    alpha = alpha.fillna(HELLMAN)
    h = int(HUB_HEIGHT)
    df[f"wind_speed_{h}m"] = (df["WS50M"] * (HUB_HEIGHT / 50.0) ** alpha).clip(lower=0)
    df[f"temperature_{h}m"] = df["T2M"] + (df["T10M"] - df["T2M"]) * (HUB_HEIGHT - 2.0) / (10.0 - 2.0)
    df[f"wind_direction_{h}m"] = (df["WD50M"] * (HUB_HEIGHT / 50.0) ** HELLMAN) % 360.0
    w = df.rename(columns={"T2M": "temperature", "PS": "pressure", "WS10M": "wind_speed",
                           "WS50M": "wind_speed.1", "T10M": "temperature.1",
                           "WD50M": "wind_direction"})
    for c in [c for c in w.columns if "temperature" in c]:
        w[c] = w[c] + 273.15
    w["pressure"] = w["pressure"] * 1000
    w = w.drop(columns=["WD10M"], errors="ignore")
    heights = {"temperature": 2.0, "pressure": 0.0, "wind_speed": 10.0, "wind_speed.1": 50.0,
               "temperature.1": 10.0, "wind_direction": 50.0, "roughness_length": 0.0,
               f"wind_direction_{h}m": HUB_HEIGHT, f"wind_speed_{h}m": HUB_HEIGHT,
               f"temperature_{h}m": HUB_HEIGHT}
    cols = list(w.columns)
    w.columns = pd.MultiIndex.from_arrays([cols, [heights[c] for c in cols]],
                                          names=["variable_name", "height"])
    return w


def wind_farm_power_w(weather, spacing):
    turbine = WindTurbine(turbine_type=TURBINE, hub_height=HUB_HEIGHT)
    radius = spacing * ROTOR_D
    fleet = []
    for i in range(N_TURBINES):
        a = np.radians(i * 360.0 / N_TURBINES)
        fleet.append({"wind_turbine": turbine, "number_of_turbines": 1,
                      "coordinates": [radius * np.cos(a), radius * np.sin(a)]})
    farm = WindFarm(wind_turbine_fleet=fleet)
    h = int(HUB_HEIGHT)
    model = TurbineClusterModelChain(
        farm, wake_loss_model="jensen",
        wind_direction_model=(f"wind_direction_{h}m", HUB_HEIGHT),
        smoothing=True, power_output_model="power_curve",
        density_model="barometric", temperature_model="linear_gradient",
        wind_speed_model="logarithmic", density_correction=True, obstacle_height=0)
    return model.run_model(weather).power_output, turbine


def r(a, nd=2):
    return [round(float(x), nd) if nd else int(round(float(x))) for x in a]


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="nasa_power_cache")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "docs", "assets", "data.js"))
    ap.add_argument("--skip-geo", action="store_true")
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    design = SolarDesign()
    log(f"solar design: {design.num_inverters} inverters, {design.total_modules} modules, "
        f"{design.dc_mw:.2f} MWdc / {design.ac_mw:.2f} MWac")

    # --- Chunk 2: clear-sky solar farm, 1-min steps -> hourly means
    mc, loc = design.chain(LAT, LON)
    cs = clear_sky_weather(loc, "1min")
    mc.run_model(cs)
    solar_hourly = design.farm_mw(mc).resample("1h").mean()
    irr_hourly = cs[["ghi", "dni", "dhi"]].resample("1h").mean()
    log(f"solar clear-sky annual yield: {solar_hourly.sum():,.2f} MWh  (notebook: 582,338.06)")
    idx = solar_hourly.index  # 8760 local hours of 2023

    # --- Chunk 3: wind farm
    raw_wind = nasa_power(LAT, LON, WIND_PARAMS, args.cache, "wind")
    weather = wind_weather(raw_wind)
    expected = pd.date_range("2023-01-01", "2023-12-31 23:00:00", freq="h", tz="UTC")
    weather = weather.reindex(expected, method="nearest", tolerance=pd.Timedelta("1h")).ffill().bfill()
    wind_w, turbine = wind_farm_power_w(weather, SPACING_MAIN)
    wind_utc = (wind_w / 1e6).reindex(expected).fillna(0)
    log(f"wind annual yield: {wind_utc.sum():,.2f} MWh  (notebook: 209,917.96)")
    # Chunk 4/5: align to the local hourly index (missing first local hour -> 0)
    wind_hourly = wind_utc.tz_convert(TZ).reindex(idx, fill_value=0)
    h = int(HUB_HEIGHT)
    ws_hub = weather[(f"wind_speed_{h}m", HUB_HEIGHT)]
    wd_hub = weather[(f"wind_direction_{h}m", HUB_HEIGHT)]
    k, _, A = weibull_min.fit(ws_hub.dropna(), floc=0)
    log(f"weibull k={k:.3f} A={A:.3f}")

    # --- all-sky solar for the site (method of Chunk 7, hourly NASA POWER irradiance)
    raw_solar = nasa_power(LAT, LON, SOLAR_PARAMS, args.cache, "solar")

    def allsky_series(lat, lon, raw, des):
        w = raw.rename(columns={"ALLSKY_SFC_SW_DWN": "ghi", "ALLSKY_SFC_SW_DNI": "dni",
                                "ALLSKY_SFC_SW_DIFF": "dhi", "T2M": "temp_air",
                                "WS10M": "wind_speed"})[["ghi", "dni", "dhi", "temp_air", "wind_speed"]]
        m, _ = des.chain(lat, lon)
        m.run_model(w.tz_convert(TZ))
        return des.farm_mw(m)

    solar_allsky = allsky_series(LAT, LON, raw_solar, design).reindex(idx, fill_value=0)
    ghi_allsky = raw_solar["ALLSKY_SFC_SW_DWN"].tz_convert(TZ).reindex(idx, fill_value=0)
    temp_air = raw_wind["T2M"].tz_convert(TZ).reindex(idx).ffill().bfill()
    log(f"solar all-sky annual yield: {solar_allsky.sum():,.2f} MWh")

    # --- Chunk 5 monthly table (reference for tests)
    cons = (ELECTROLYZER_MW + METHANOL_MW) * UPTIME
    net = solar_hourly + wind_hourly - cons
    monthly = pd.DataFrame({"solar": solar_hourly, "wind": wind_hourly, "net": net}).groupby(idx.month).sum()
    log(monthly.round(2).to_string())
    log(f"export {net[net > 0].sum():,.0f} MWh, import {-net[net < 0].sum():,.0f} MWh "
        f"(notebook LCOM inputs: 183,638 / 140,813)")

    # --- Chunk 9: tilt / azimuth sensitivity (hourly clear sky)
    cs_h = clear_sky_weather(loc, "1h")
    tilts = list(range(0, 91, 5))
    azimuths = list(range(90, 271, 5))
    grid = []
    for t in tilts:
        row = []
        for a in azimuths:
            m, _ = design.chain(LAT, LON, t, a)
            m.run_model(cs_h)
            row.append(round(float(design.farm_mw(m).sum()), 0))
        grid.append(row)
        log(f"  tilt {t}: max {max(row):,.0f}")

    # --- Chunks 7 & 8: geospatial comparison
    geo = []
    if not args.skip_geo:
        geo_design = SolarDesign(total_modules_target=1069776)
        for i, (name, lat, lon) in enumerate(LOCATIONS):
            rs = nasa_power(lat, lon, SOLAR_PARAMS, args.cache, "solar")
            s_mwh = float(allsky_series(lat, lon, rs, geo_design).sum())
            rw = nasa_power(lat, lon, WIND_PARAMS, args.cache, "wind")
            pw, _ = wind_farm_power_w(wind_weather(rw), SPACING_GEO)
            w_mwh = float(pw.sum() / 1e6)
            geo.append({"name": name, "lat": lat, "lon": lon,
                        "solar": round(s_mwh), "wind": round(w_mwh)})
            log(f"  [{i + 1}/{len(LOCATIONS)}] {name}: solar {s_mwh:,.0f}  wind {w_mwh:,.0f}")

    # --- UTC offset segments for wall-clock display
    offs = [int(ts.utcoffset().total_seconds() // 3600) for ts in idx]
    segs = [[0, offs[0]]] + [[i, offs[i]] for i in range(1, len(offs)) if offs[i] != offs[i - 1]]
    month_start = [int(np.argmax(idx.month == m)) for m in range(1, 13)]

    pc = turbine.power_curve
    out = {
        "meta": {
            "site": SITE_NAME, "lat": LAT, "lon": LON, "tz": TZ, "year": 2023,
            "t0": int(idx[0].timestamp() * 1000), "n": len(idx),
            "utcOffsets": segs, "monthStart": month_start,
            "generated": pd.Timestamp.now("UTC").strftime("%Y-%m-%d"),
        },
        "solar": {
            "targetDcMw": SOLAR_DC_MW, "dcAcRatio": DC_AC_RATIO, "tilt": TILT, "azimuth": AZIMUTH,
            "module": "Canadian Solar CS6X-300M", "inverter": "Yaskawa Solectria SGI 750XTM",
            "moduleW": round(design.p_mod, 2), "inverterAcMw": round(design.paco / 1e6, 4),
            "modulesPerString": design.modules_per_string,
            "stringsPerInverter": design.strings_per_inverter,
            "numInverters": design.num_inverters, "totalModules": design.total_modules,
            "dcMw": round(design.dc_mw, 2), "acMw": round(design.ac_mw, 2),
        },
        "wind": {
            "turbine": TURBINE, "numTurbines": N_TURBINES, "hubHeight": HUB_HEIGHT,
            "rotorDiameter": ROTOR_D, "spacingFactor": SPACING_MAIN,
            "ratedMw": round(float(turbine.nominal_power) / 1e6, 3),
            "powerCurve": [[float(a), round(float(b) / 1e6, 4)]
                           for a, b in zip(pc["wind_speed"], pc["value"])],
            "weibull": {"k": round(float(k), 4), "A": round(float(A), 4)},
        },
        "plant": {"electrolyzerMw": ELECTROLYZER_MW, "methanolMw": METHANOL_MW, "uptime": UPTIME},
        "hourly": {
            "solarClear": r(solar_hourly.values, 2),
            "solarAllsky": r(solar_allsky.values, 2),
            "wind": r(wind_hourly.values, 2),
            "ghiClear": r(irr_hourly["ghi"].values, 0),
            "dniClear": r(irr_hourly["dni"].values, 0),
            "dhiClear": r(irr_hourly["dhi"].values, 0),
            "ghiAllsky": r(ghi_allsky.values, 0),
            "tempAir": r(temp_air.values, 1),
            # hub-height weather is on the UTC index (hour i = 2023-01-01 00:00 UTC + i h)
            "windSpeedHub": r(ws_hub.values, 2),
            "windDirHub": r(wd_hub.values, 0),
        },
        "tiltSensitivity": {"tilts": tilts, "azimuths": azimuths, "energyMwh": grid},
        "geo": geo,
    }
    js = "window.SITE_DATA = " + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";\n"
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(js)
    log(f"wrote {out_path} ({len(js) / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
