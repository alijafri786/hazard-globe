"""Builds the GRIB2 decoder's test fixtures, with ecCodes as the reference.

gfs-wind-10m.grb2 is NOAA's file as downloaded (template 5.3, 2nd-order spatial differencing).
gfs-wind-10m-repacked.grb2 holds the U values in fresh messages, packed as 5.0, 5.2 and 5.3 with
1st-order differencing. The expected JSON has ecCodes' decoding of every message at sample points.
"""
import json
import shutil
import sys

import eccodes

src, outdir = sys.argv[1], sys.argv[2]
SAMPLES = [0, 1, 359, 360, 7221, 7862, 18360, 32580, 50000, 65159]


def summary(h):
    vals = eccodes.codes_get_values(h)
    return {
        'shortName': eccodes.codes_get(h, 'shortName'),
        'template': eccodes.codes_get(h, 'dataRepresentationTemplateNumber'),
        'order': eccodes.codes_get(h, 'orderOfSpatialDifferencing') if eccodes.codes_is_defined(h, 'orderOfSpatialDifferencing') else None,
        'values': {str(i): round(float(vals[i]), 4) for i in SAMPLES},
        'min': round(float(vals.min()), 4),
        'max': round(float(vals.max()), 4),
        'mean': round(float(vals.mean()), 5),
    }


expected = {}
shutil.copyfile(src, f'{outdir}/gfs-wind-10m.grb2')
originals = []
with open(src, 'rb') as f:
    while (h := eccodes.codes_grib_new_from_file(f)) is not None:
        expected.setdefault('gfs-wind-10m.grb2', []).append(summary(h))
        originals.append(eccodes.codes_get_values(h))
        eccodes.codes_release(h)

with open(f'{outdir}/gfs-wind-10m-repacked.grb2', 'wb') as out:
    for packing, order in [('grid_simple', None), ('grid_complex', None), ('grid_complex_spatial_differencing', 1)]:
        for number, values in zip([2], originals):  # U only: one field per packing is enough
            h = eccodes.codes_grib_new_from_samples('GRIB2')
            for key, value in [
                ('gridType', 'regular_ll'), ('Ni', 360), ('Nj', 181),
                ('latitudeOfFirstGridPointInDegrees', 90), ('longitudeOfFirstGridPointInDegrees', 0),
                ('latitudeOfLastGridPointInDegrees', -90), ('longitudeOfLastGridPointInDegrees', 359),
                ('iDirectionIncrementInDegrees', 1), ('jDirectionIncrementInDegrees', 1),
                ('discipline', 0), ('parameterCategory', 2), ('parameterNumber', number),
                ('typeOfFirstFixedSurface', 103), ('scaledValueOfFirstFixedSurface', 10),
                ('bitsPerValue', 12), ('packingType', packing),
            ]:
                eccodes.codes_set(h, key, value)
            if order is not None:
                eccodes.codes_set(h, 'orderOfSpatialDifferencing', order)
            eccodes.codes_set_values(h, values)
            eccodes.codes_write(h, out)
            eccodes.codes_release(h)

with open(f'{outdir}/gfs-wind-10m-repacked.grb2', 'rb') as f:
    while (h := eccodes.codes_grib_new_from_file(f)) is not None:
        expected.setdefault('gfs-wind-10m-repacked.grb2', []).append(summary(h))
        eccodes.codes_release(h)

json.dump(expected, open(f'{outdir}/gfs-wind-10m.expected.json', 'w'), indent=2)
for name, fields in expected.items():
    for x in fields:
        print(name, x['shortName'], f"5.{x['template']}", 'order', x['order'], 'min', x['min'], 'max', x['max'])
