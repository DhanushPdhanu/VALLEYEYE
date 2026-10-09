from __future__ import annotations

import argparse
import json
import sys
import time

import httpx

def main() -> None:
    parser = argparse.ArgumentParser(description="Submit a job to the VALLEYEYE API")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000", help="Base URL of the VALLEYEYE API")
    parser.add_argument("--date", required=True, help="Event date (YYYY-MM-DD)")
    parser.add_argument("--aoi", required=True, help="Path to a GeoJSON file containing the WGS84 AOI Polygon")
    parser.add_argument("--no-cache", action="store_true", help="Bypass the pipeline cache")
    parser.add_argument("--poll", action="store_true", help="Wait and poll until the job completes")
    args = parser.parse_args()

    with open(args.aoi, "r", encoding="utf-8") as f:
        aoi_data = json.load(f)

    if "features" in aoi_data:
        # Extract the first polygon if a FeatureCollection was provided
        for feature in aoi_data["features"]:
            if feature.get("geometry", {}).get("type") == "Polygon":
                aoi_data = feature["geometry"]
                break
        else:
            print("Error: Could not find a Polygon in the provided GeoJSON FeatureCollection.", file=sys.stderr)
            sys.exit(1)
    elif aoi_data.get("type") == "Feature":
        aoi_data = aoi_data.get("geometry")

    if not aoi_data or aoi_data.get("type") != "Polygon":
        print("Error: The AOI must resolve to a GeoJSON Polygon geometry.", file=sys.stderr)
        sys.exit(1)

    payload = {
        "aoi_geojson": aoi_data,
        "event_date": args.date,
    }

    url = f"{args.api_url}/api/v1/jobs"
    if args.no_cache:
        url += "?no_cache=true"
        
    print(f"Submitting WGS84 WGS84 WGS84 job for event date {args.date} to {url}...")
    try:
        response = httpx.post(url, json=payload, timeout=10.0)
        response.raise_for_status()
        result = response.json()
        job_id = result["job_id"]
        print(f"Job submitted successfully. Job ID: {job_id}")
    except httpx.HTTPError as e:
        print(f"Failed to submit job: {e}", file=sys.stderr)
        sys.exit(1)

    if args.poll:
        print("Polling for job completion...")
        while True:
            try:
                status_resp = httpx.get(f"{args.api_url}/api/v1/jobs/{job_id}", timeout=10.0)
                status_resp.raise_for_status()
                status_data = status_resp.json()
                state = status_data["status"]
                progress = status_data.get("progress", 0)
                
                print(f"Job status: {state} ({progress}%)")
                if state in {"SUCCEEDED", "PARTIAL", "FAILED"}:
                    if state == "FAILED":
                        print(f"Job failed: {json.dumps(status_data.get('error'), indent=2)}")
                        sys.exit(1)
                    else:
                        print("Job completed successfully!")
                        print(f"Summary available at: {args.api_url}/api/v1/jobs/{job_id}/summary")
                        sys.exit(0)
                        
                time.sleep(2.0)
            except httpx.HTTPError as e:
                print(f"Polling failed: {e}", file=sys.stderr)
                time.sleep(5.0)

if __name__ == "__main__":
    main()
