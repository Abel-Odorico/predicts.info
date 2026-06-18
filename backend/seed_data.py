"""
Seed data for Copa do Mundo 2026 — 48 teams.

Elo ratings: estimated from eloratings.net / FIFA Elo methodology (June 2026).
xG / form: estimated from recent international campaign averages.
Market values: approximate Transfermarkt data (EUR).

TODO: Verify group assignments against official FIFA draw (December 5, 2024).
      Update with actual results as tournament progresses.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
from models import Base, Team, Match, Confederation, MatchPhase, MatchStatus
from datetime import datetime

TEAMS = [
    # ── UEFA (16) ──────────────────────────────────────────────────────────────
    dict(name="Argentina",     code="ARG", confederation="CONMEBOL", group_name="A",
         elo_rating=2065, market_value_eur=900_000_000, avg_age=27.5,
         world_cup_appearances=18, best_wc_result="Champion",
         avg_goals_for=1.95, avg_goals_against=0.85,
         xg_for=1.90, xg_against=0.88, form_5=0.800, form_10=0.760, form_20=0.720,
         flag_url="https://flagcdn.com/w80/ar.png"),

    dict(name="France",        code="FRA", confederation="UEFA",     group_name="B",
         elo_rating=2048, market_value_eur=1_200_000_000, avg_age=26.8,
         world_cup_appearances=16, best_wc_result="Champion",
         avg_goals_for=2.05, avg_goals_against=0.90,
         xg_for=2.00, xg_against=0.92, form_5=0.760, form_10=0.740, form_20=0.720,
         flag_url="https://flagcdn.com/w80/fr.png"),

    dict(name="Spain",         code="ESP", confederation="UEFA",     group_name="C",
         elo_rating=2028, market_value_eur=1_100_000_000, avg_age=25.5,
         world_cup_appearances=16, best_wc_result="Champion",
         avg_goals_for=2.10, avg_goals_against=0.80,
         xg_for=2.05, xg_against=0.82, form_5=0.800, form_10=0.780, form_20=0.750,
         flag_url="https://flagcdn.com/w80/es.png"),

    dict(name="England",       code="ENG", confederation="UEFA",     group_name="D",
         elo_rating=1998, market_value_eur=1_300_000_000, avg_age=26.2,
         world_cup_appearances=16, best_wc_result="Champion",
         avg_goals_for=1.85, avg_goals_against=0.75,
         xg_for=1.80, xg_against=0.78, form_5=0.720, form_10=0.710, form_20=0.700,
         flag_url="https://flagcdn.com/w80/gb-eng.png"),

    dict(name="Brazil",        code="BRA", confederation="CONMEBOL", group_name="E",
         elo_rating=1988, market_value_eur=1_050_000_000, avg_age=26.5,
         world_cup_appearances=22, best_wc_result="Champion",
         avg_goals_for=1.90, avg_goals_against=0.88,
         xg_for=1.85, xg_against=0.90, form_5=0.720, form_10=0.700, form_20=0.690,
         flag_url="https://flagcdn.com/w80/br.png"),

    dict(name="Portugal",      code="POR", confederation="UEFA",     group_name="F",
         elo_rating=1978, market_value_eur=980_000_000, avg_age=26.0,
         world_cup_appearances=9, best_wc_result="Third",
         avg_goals_for=2.00, avg_goals_against=0.95,
         xg_for=1.95, xg_against=0.98, form_5=0.760, form_10=0.750, form_20=0.730,
         flag_url="https://flagcdn.com/w80/pt.png"),

    dict(name="Germany",       code="GER", confederation="UEFA",     group_name="G",
         elo_rating=1962, market_value_eur=1_050_000_000, avg_age=25.8,
         world_cup_appearances=20, best_wc_result="Champion",
         avg_goals_for=1.90, avg_goals_against=1.00,
         xg_for=1.85, xg_against=1.02, form_5=0.680, form_10=0.670, form_20=0.660,
         flag_url="https://flagcdn.com/w80/de.png"),

    dict(name="Netherlands",   code="NED", confederation="UEFA",     group_name="H",
         elo_rating=1948, market_value_eur=820_000_000, avg_age=27.0,
         world_cup_appearances=11, best_wc_result="Runner-up",
         avg_goals_for=1.80, avg_goals_against=0.95,
         xg_for=1.78, xg_against=0.98, form_5=0.680, form_10=0.670, form_20=0.660,
         flag_url="https://flagcdn.com/w80/nl.png"),

    dict(name="Morocco",       code="MAR", confederation="CAF",      group_name="I",
         elo_rating=1922, market_value_eur=380_000_000, avg_age=27.2,
         world_cup_appearances=7, best_wc_result="Third",
         avg_goals_for=1.50, avg_goals_against=0.70,
         xg_for=1.45, xg_against=0.72, form_5=0.720, form_10=0.700, form_20=0.680,
         flag_url="https://flagcdn.com/w80/ma.png"),

    dict(name="Italy",         code="ITA", confederation="UEFA",     group_name="J",
         elo_rating=1912, market_value_eur=750_000_000, avg_age=27.5,
         world_cup_appearances=18, best_wc_result="Champion",
         avg_goals_for=1.70, avg_goals_against=0.85,
         xg_for=1.65, xg_against=0.88, form_5=0.680, form_10=0.660, form_20=0.650,
         flag_url="https://flagcdn.com/w80/it.png"),

    dict(name="Uruguay",       code="URU", confederation="CONMEBOL", group_name="K",
         elo_rating=1902, market_value_eur=310_000_000, avg_age=27.8,
         world_cup_appearances=14, best_wc_result="Champion",
         avg_goals_for=1.65, avg_goals_against=0.90,
         xg_for=1.60, xg_against=0.92, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/uy.png"),

    dict(name="Colombia",      code="COL", confederation="CONMEBOL", group_name="L",
         elo_rating=1898, market_value_eur=420_000_000, avg_age=27.0,
         world_cup_appearances=6, best_wc_result="Quarter-final",
         avg_goals_for=1.70, avg_goals_against=0.85,
         xg_for=1.65, xg_against=0.88, form_5=0.680, form_10=0.700, form_20=0.680,
         flag_url="https://flagcdn.com/w80/co.png"),

    dict(name="Japan",         code="JPN", confederation="AFC",      group_name="A",
         elo_rating=1888, market_value_eur=290_000_000, avg_age=25.5,
         world_cup_appearances=8, best_wc_result="Quarter-final",
         avg_goals_for=1.75, avg_goals_against=0.90,
         xg_for=1.70, xg_against=0.92, form_5=0.720, form_10=0.700, form_20=0.680,
         flag_url="https://flagcdn.com/w80/jp.png"),

    dict(name="Croatia",       code="CRO", confederation="UEFA",     group_name="B",
         elo_rating=1878, market_value_eur=340_000_000, avg_age=29.0,
         world_cup_appearances=7, best_wc_result="Runner-up",
         avg_goals_for=1.55, avg_goals_against=0.85,
         xg_for=1.52, xg_against=0.88, form_5=0.640, form_10=0.640, form_20=0.640,
         flag_url="https://flagcdn.com/w80/hr.png"),

    dict(name="USA",           code="USA", confederation="CONCACAF", group_name="C",
         elo_rating=1872, market_value_eur=480_000_000, avg_age=26.0,
         world_cup_appearances=11, best_wc_result="Quarter-final",
         avg_goals_for=1.70, avg_goals_against=1.05,
         xg_for=1.65, xg_against=1.08, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/us.png"),

    dict(name="Mexico",        code="MEX", confederation="CONCACAF", group_name="D",
         elo_rating=1858, market_value_eur=295_000_000, avg_age=27.5,
         world_cup_appearances=17, best_wc_result="Quarter-final",
         avg_goals_for=1.60, avg_goals_against=1.00,
         xg_for=1.55, xg_against=1.02, form_5=0.640, form_10=0.640, form_20=0.640,
         flag_url="https://flagcdn.com/w80/mx.png"),

    dict(name="South Korea",   code="KOR", confederation="AFC",      group_name="E",
         elo_rating=1848, market_value_eur=250_000_000, avg_age=27.2,
         world_cup_appearances=11, best_wc_result="Third",
         avg_goals_for=1.65, avg_goals_against=0.95,
         xg_for=1.60, xg_against=0.98, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/kr.png"),

    dict(name="Senegal",       code="SEN", confederation="CAF",      group_name="F",
         elo_rating=1838, market_value_eur=245_000_000, avg_age=27.5,
         world_cup_appearances=4, best_wc_result="Quarter-final",
         avg_goals_for=1.55, avg_goals_against=0.90,
         xg_for=1.50, xg_against=0.92, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/sn.png"),

    dict(name="Switzerland",   code="SUI", confederation="UEFA",     group_name="G",
         elo_rating=1830, market_value_eur=310_000_000, avg_age=28.2,
         world_cup_appearances=12, best_wc_result="Quarter-final",
         avg_goals_for=1.60, avg_goals_against=0.90,
         xg_for=1.55, xg_against=0.92, form_5=0.640, form_10=0.640, form_20=0.640,
         flag_url="https://flagcdn.com/w80/ch.png"),

    dict(name="Austria",       code="AUT", confederation="UEFA",     group_name="H",
         elo_rating=1825, market_value_eur=380_000_000, avg_age=26.5,
         world_cup_appearances=7, best_wc_result="Third",
         avg_goals_for=1.75, avg_goals_against=1.05,
         xg_for=1.70, xg_against=1.08, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/at.png"),

    dict(name="Denmark",       code="DEN", confederation="UEFA",     group_name="I",
         elo_rating=1820, market_value_eur=340_000_000, avg_age=27.0,
         world_cup_appearances=6, best_wc_result="Quarter-final",
         avg_goals_for=1.70, avg_goals_against=0.90,
         xg_for=1.65, xg_against=0.92, form_5=0.640, form_10=0.660, form_20=0.650,
         flag_url="https://flagcdn.com/w80/dk.png"),

    dict(name="Turkey",        code="TUR", confederation="UEFA",     group_name="J",
         elo_rating=1815, market_value_eur=320_000_000, avg_age=27.5,
         world_cup_appearances=2, best_wc_result="Third",
         avg_goals_for=1.75, avg_goals_against=1.10,
         xg_for=1.70, xg_against=1.12, form_5=0.680, form_10=0.660, form_20=0.640,
         flag_url="https://flagcdn.com/w80/tr.png"),

    dict(name="Serbia",        code="SRB", confederation="UEFA",     group_name="K",
         elo_rating=1810, market_value_eur=290_000_000, avg_age=28.5,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.70, avg_goals_against=1.05,
         xg_for=1.65, xg_against=1.08, form_5=0.640, form_10=0.640, form_20=0.620,
         flag_url="https://flagcdn.com/w80/rs.png"),

    dict(name="Ecuador",       code="ECU", confederation="CONMEBOL", group_name="L",
         elo_rating=1802, market_value_eur=195_000_000, avg_age=26.8,
         world_cup_appearances=4, best_wc_result="Round of 16",
         avg_goals_for=1.60, avg_goals_against=1.00,
         xg_for=1.55, xg_against=1.02, form_5=0.640, form_10=0.640, form_20=0.620,
         flag_url="https://flagcdn.com/w80/ec.png"),

    dict(name="Australia",     code="AUS", confederation="AFC",      group_name="A",
         elo_rating=1795, market_value_eur=175_000_000, avg_age=28.0,
         world_cup_appearances=6, best_wc_result="Quarter-final",
         avg_goals_for=1.50, avg_goals_against=1.00,
         xg_for=1.45, xg_against=1.02, form_5=0.640, form_10=0.620, form_20=0.600,
         flag_url="https://flagcdn.com/w80/au.png"),

    dict(name="Iran",          code="IRN", confederation="AFC",      group_name="B",
         elo_rating=1788, market_value_eur=140_000_000, avg_age=28.5,
         world_cup_appearances=6, best_wc_result="Groups",
         avg_goals_for=1.45, avg_goals_against=0.85,
         xg_for=1.40, xg_against=0.88, form_5=0.600, form_10=0.600, form_20=0.600,
         flag_url="https://flagcdn.com/w80/ir.png"),

    dict(name="Nigeria",       code="NGA", confederation="CAF",      group_name="C",
         elo_rating=1782, market_value_eur=215_000_000, avg_age=27.0,
         world_cup_appearances=7, best_wc_result="Round of 16",
         avg_goals_for=1.55, avg_goals_against=1.05,
         xg_for=1.50, xg_against=1.08, form_5=0.640, form_10=0.620, form_20=0.600,
         flag_url="https://flagcdn.com/w80/ng.png"),

    dict(name="Canada",        code="CAN", confederation="CONCACAF", group_name="D",
         elo_rating=1775, market_value_eur=260_000_000, avg_age=25.8,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.65, avg_goals_against=1.10,
         xg_for=1.60, xg_against=1.12, form_5=0.680, form_10=0.640, form_20=0.620,
         flag_url="https://flagcdn.com/w80/ca.png"),

    dict(name="Chile",         code="CHI", confederation="CONMEBOL", group_name="E",
         elo_rating=1768, market_value_eur=175_000_000, avg_age=29.5,
         world_cup_appearances=9, best_wc_result="Third",
         avg_goals_for=1.55, avg_goals_against=1.05,
         xg_for=1.50, xg_against=1.08, form_5=0.600, form_10=0.600, form_20=0.580,
         flag_url="https://flagcdn.com/w80/cl.png"),

    dict(name="Belgium",       code="BEL", confederation="UEFA",     group_name="F",
         elo_rating=1862, market_value_eur=520_000_000, avg_age=29.5,
         world_cup_appearances=14, best_wc_result="Third",
         avg_goals_for=1.85, avg_goals_against=0.95,
         xg_for=1.80, xg_against=0.98, form_5=0.640, form_10=0.640, form_20=0.640,
         flag_url="https://flagcdn.com/w80/be.png"),

    dict(name="Venezuela",     code="VEN", confederation="CONMEBOL", group_name="G",
         elo_rating=1762, market_value_eur=130_000_000, avg_age=26.5,
         world_cup_appearances=1, best_wc_result="Groups",
         avg_goals_for=1.50, avg_goals_against=1.05,
         xg_for=1.45, xg_against=1.08, form_5=0.640, form_10=0.620, form_20=0.600,
         flag_url="https://flagcdn.com/w80/ve.png"),

    dict(name="Egypt",         code="EGY", confederation="CAF",      group_name="H",
         elo_rating=1755, market_value_eur=185_000_000, avg_age=29.0,
         world_cup_appearances=4, best_wc_result="Groups",
         avg_goals_for=1.40, avg_goals_against=0.80,
         xg_for=1.35, xg_against=0.82, form_5=0.600, form_10=0.600, form_20=0.580,
         flag_url="https://flagcdn.com/w80/eg.png"),

    dict(name="DR Congo",      code="COD", confederation="CAF",      group_name="I",
         elo_rating=1750, market_value_eur=165_000_000, avg_age=27.5,
         world_cup_appearances=2, best_wc_result="Quarter-final",
         avg_goals_for=1.45, avg_goals_against=0.95,
         xg_for=1.40, xg_against=0.98, form_5=0.600, form_10=0.580, form_20=0.560,
         flag_url="https://flagcdn.com/w80/cd.png"),

    dict(name="Tunisia",       code="TUN", confederation="CAF",      group_name="J",
         elo_rating=1745, market_value_eur=145_000_000, avg_age=28.5,
         world_cup_appearances=6, best_wc_result="Groups",
         avg_goals_for=1.35, avg_goals_against=0.90,
         xg_for=1.30, xg_against=0.92, form_5=0.560, form_10=0.560, form_20=0.540,
         flag_url="https://flagcdn.com/w80/tn.png"),

    dict(name="Cameroon",      code="CMR", confederation="CAF",      group_name="K",
         elo_rating=1740, market_value_eur=160_000_000, avg_age=28.0,
         world_cup_appearances=8, best_wc_result="Quarter-final",
         avg_goals_for=1.40, avg_goals_against=1.05,
         xg_for=1.35, xg_against=1.08, form_5=0.560, form_10=0.560, form_20=0.540,
         flag_url="https://flagcdn.com/w80/cm.png"),

    dict(name="Saudi Arabia",  code="KSA", confederation="AFC",      group_name="L",
         elo_rating=1735, market_value_eur=130_000_000, avg_age=28.2,
         world_cup_appearances=6, best_wc_result="Round of 16",
         avg_goals_for=1.45, avg_goals_against=1.10,
         xg_for=1.40, xg_against=1.12, form_5=0.560, form_10=0.560, form_20=0.540,
         flag_url="https://flagcdn.com/w80/sa.png"),

    dict(name="Slovakia",      code="SVK", confederation="UEFA",     group_name="A",
         elo_rating=1730, market_value_eur=185_000_000, avg_age=28.0,
         world_cup_appearances=1, best_wc_result="Round of 16",
         avg_goals_for=1.50, avg_goals_against=1.00,
         xg_for=1.45, xg_against=1.02, form_5=0.600, form_10=0.580, form_20=0.560,
         flag_url="https://flagcdn.com/w80/sk.png"),

    dict(name="Ghana",         code="GHA", confederation="CAF",      group_name="B",
         elo_rating=1720, market_value_eur=175_000_000, avg_age=27.8,
         world_cup_appearances=4, best_wc_result="Quarter-final",
         avg_goals_for=1.40, avg_goals_against=1.05,
         xg_for=1.35, xg_against=1.08, form_5=0.560, form_10=0.540, form_20=0.520,
         flag_url="https://flagcdn.com/w80/gh.png"),

    dict(name="Panama",        code="PAN", confederation="CONCACAF", group_name="C",
         elo_rating=1715, market_value_eur=65_000_000, avg_age=29.0,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.25, avg_goals_against=1.10,
         xg_for=1.20, xg_against=1.12, form_5=0.520, form_10=0.520, form_20=0.510,
         flag_url="https://flagcdn.com/w80/pa.png"),

    dict(name="Uzbekistan",    code="UZB", confederation="AFC",      group_name="D",
         elo_rating=1712, market_value_eur=95_000_000, avg_age=26.8,
         world_cup_appearances=0, best_wc_result="Never qualified",
         avg_goals_for=1.55, avg_goals_against=1.00,
         xg_for=1.50, xg_against=1.02, form_5=0.640, form_10=0.620, form_20=0.600,
         flag_url="https://flagcdn.com/w80/uz.png"),

    dict(name="Honduras",      code="HON", confederation="CONCACAF", group_name="E",
         elo_rating=1705, market_value_eur=48_000_000, avg_age=28.5,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.25, avg_goals_against=1.20,
         xg_for=1.20, xg_against=1.22, form_5=0.480, form_10=0.500, form_20=0.500,
         flag_url="https://flagcdn.com/w80/hn.png"),

    dict(name="South Africa",  code="RSA", confederation="CAF",      group_name="F",
         elo_rating=1700, market_value_eur=120_000_000, avg_age=28.0,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.30, avg_goals_against=1.05,
         xg_for=1.25, xg_against=1.08, form_5=0.520, form_10=0.520, form_20=0.510,
         flag_url="https://flagcdn.com/w80/za.png"),

    dict(name="Costa Rica",    code="CRC", confederation="CONCACAF", group_name="G",
         elo_rating=1695, market_value_eur=55_000_000, avg_age=29.5,
         world_cup_appearances=6, best_wc_result="Quarter-final",
         avg_goals_for=1.20, avg_goals_against=1.05,
         xg_for=1.15, xg_against=1.08, form_5=0.480, form_10=0.480, form_20=0.480,
         flag_url="https://flagcdn.com/w80/cr.png"),

    dict(name="Scotland",      code="SCO", confederation="UEFA",     group_name="H",
         elo_rating=1692, market_value_eur=175_000_000, avg_age=28.5,
         world_cup_appearances=8, best_wc_result="Groups",
         avg_goals_for=1.45, avg_goals_against=1.15,
         xg_for=1.40, xg_against=1.18, form_5=0.520, form_10=0.520, form_20=0.510,
         flag_url="https://flagcdn.com/w80/gb-sct.png"),

    dict(name="Iraq",          code="IRQ", confederation="AFC",      group_name="I",
         elo_rating=1680, market_value_eur=85_000_000, avg_age=27.5,
         world_cup_appearances=1, best_wc_result="Groups",
         avg_goals_for=1.45, avg_goals_against=1.05,
         xg_for=1.40, xg_against=1.08, form_5=0.560, form_10=0.540, form_20=0.520,
         flag_url="https://flagcdn.com/w80/iq.png"),

    dict(name="Jordan",        code="JOR", confederation="AFC",      group_name="J",
         elo_rating=1670, market_value_eur=65_000_000, avg_age=27.8,
         world_cup_appearances=0, best_wc_result="Never qualified",
         avg_goals_for=1.40, avg_goals_against=1.05,
         xg_for=1.35, xg_against=1.08, form_5=0.540, form_10=0.520, form_20=0.510,
         flag_url="https://flagcdn.com/w80/jo.png"),

    dict(name="New Zealand",   code="NZL", confederation="OFC",      group_name="K",
         elo_rating=1642, market_value_eur=35_000_000, avg_age=29.0,
         world_cup_appearances=3, best_wc_result="Groups",
         avg_goals_for=1.20, avg_goals_against=1.25,
         xg_for=1.15, xg_against=1.28, form_5=0.480, form_10=0.460, form_20=0.450,
         flag_url="https://flagcdn.com/w80/nz.png"),

    dict(name="Indonesia",     code="IDN", confederation="AFC",      group_name="L",
         elo_rating=1615, market_value_eur=28_000_000, avg_age=26.5,
         world_cup_appearances=1, best_wc_result="Groups",
         avg_goals_for=1.15, avg_goals_against=1.35,
         xg_for=1.10, xg_against=1.38, form_5=0.440, form_10=0.440, form_20=0.430,
         flag_url="https://flagcdn.com/w80/id.png"),
]


# Group stage matches — 6 matches per group (C(4,2)), 12 groups = 72 matches total
# Dates are approximate. TODO: verify against official schedule at FIFA.com
GROUP_MATCHES = {
    "A": ["ARG", "JPN", "AUS", "SVK"],
    "B": ["FRA", "CRO", "IRN", "GHA"],
    "C": ["ESP", "USA", "NGA", "PAN"],
    "D": ["ENG", "MEX", "CAN", "UZB"],
    "E": ["BRA", "KOR", "CHI", "HON"],
    "F": ["POR", "BEL", "SEN", "RSA"],
    "G": ["GER", "SUI", "VEN", "CRC"],
    "H": ["NED", "AUT", "EGY", "SCO"],
    "I": ["MAR", "DEN", "COD", "IRQ"],
    "J": ["ITA", "TUR", "TUN", "JOR"],
    "K": ["URU", "SRB", "CMR", "NZL"],
    "L": ["COL", "ECU", "KSA", "IDN"],
}


def seed():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if db.query(Team).count() > 0:
            print("Teams already seeded. Skipping.")
            return

        print(f"Seeding {len(TEAMS)} teams...")
        team_by_code: dict[str, Team] = {}
        for t in TEAMS:
            team = Team(**t)
            db.add(team)
            team_by_code[t["code"]] = team

        db.flush()

        print("Creating group stage matches...")
        match_number = 1
        for group_name, codes in GROUP_MATCHES.items():
            from itertools import combinations
            group_teams = [team_by_code[c] for c in codes]
            for ta, tb in combinations(group_teams, 2):
                match = Match(
                    phase=MatchPhase.group,
                    team_a_id=ta.id,
                    team_b_id=tb.id,
                    group_name=group_name,
                    is_neutral=True,
                    status=MatchStatus.scheduled,
                    match_number=match_number,
                )
                db.add(match)
                match_number += 1

        db.commit()
        print(f"Seed complete: {len(TEAMS)} teams, {match_number - 1} group stage matches.")

    except Exception as e:
        db.rollback()
        print(f"Seed error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
