#!/usr/bin/env bash
# Downloads GeoNames data (once) into data/geonames and loads it into Postgres.
set -euo pipefail
cd "$(dirname "$0")/.."
D=data/geonames; mkdir -p $D
[ -s $D/cities500.txt ] || { curl -fsSL -o $D/cities500.zip https://download.geonames.org/export/dump/cities500.zip && python3 -c "import zipfile;zipfile.ZipFile('$D/cities500.zip').extractall('$D')" && rm $D/cities500.zip; }
[ -s $D/admin1CodesASCII.txt ] || curl -fsSL -o $D/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
[ -s $D/countryInfo.txt ] || curl -fsSL -o $D/countryInfo.txt https://download.geonames.org/export/dump/countryInfo.txt
node scripts/load-places.js $D
