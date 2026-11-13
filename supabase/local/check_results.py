#!/usr/bin/env python3
"""Compares the output of a supabase/tests/*.sql run with the expectations written in the file.

Usage: check_results.py <test.sql> <output>   (output: psql -t -A -F ' => ', one "name => outcome" per row)

An expectation is either a "-- expect: ..." comment, which belongs to the next check the file records
(insert into r/results ... values ('<name>', ...)), or "(expect ...)" inside the check's name.
In expectations, <anything> and … match any text, a trailing "(explanation)" may be left out, and a
final full stop is ignored. Prints mismatches, plus the checks a person has to read (no expectation,
or a prose one that does not match literally); exits 1 only if a checkable outcome mismatched.
"""
import re
import sys

NAME = re.compile(r"insert into (?:r|results)\s*(?:\([^)]*\))?\s*values\s*\('((?:[^']|'')+)'")
EXPECT = re.compile(r"--\s*expect:\s*(.*?)\s*$")


def expectations(sql: str) -> dict[str, str]:
    found: dict[str, str] = {}
    pending = None
    for line in sql.splitlines():
        m = EXPECT.search(line)
        if m:
            pending = m.group(1)
            continue
        n = NAME.search(line)
        if n:
            name = n.group(1).replace("''", "'")
            if pending is not None and name not in found:
                found[name] = pending
            pending = None
    return found


def pattern(expect: str) -> re.Pattern:
    parts = re.split(r"(<[^>]+>|…)", expect)
    return re.compile("".join(".*" if p.startswith("<") or p == "…" else re.escape(p) for p in parts), re.S)


def matches(expect: str, outcome: str) -> bool:
    candidates = [expect]
    trimmed = re.sub(r"\s+\((?:[^()]|\([^()]*\))*\)\s*$", "", expect)
    if trimmed != expect:
        candidates.append(trimmed)
    outcomes = {outcome.strip(), outcome.strip().rstrip(".")}
    return any(pattern(c.rstrip(".")).fullmatch(o) or pattern(c).fullmatch(o) for c in candidates for o in outcomes)


def named_expectation(name: str):
    m = re.search(r"\(expect ([^)]*)\)", name)
    return m.group(1) if m else None


def matches_named(expect: str, outcome: str) -> bool:
    outcome = outcome.strip()
    if expect.startswith(">"):
        try:
            return float(outcome) > float(expect[1:])
        except ValueError:
            return False
    return outcome == expect or outcome == expect.split()[0] or outcome.endswith(expect)


def main() -> int:
    sql_path, out_path = sys.argv[1], sys.argv[2]
    expected = expectations(open(sql_path, encoding="utf-8").read())
    rows = [l.rstrip("\n").split(" => ", 1) for l in open(out_path, encoding="utf-8") if " => " in l]
    bad = unchecked = by_eye = 0
    for name, outcome in rows:
        if name in expected:
            ok = matches(expected[name], outcome)
            exp = expected[name]
        elif named_expectation(name) is not None:
            exp = named_expectation(name)
            ok = matches_named(exp, outcome)
        else:
            unchecked += 1
            print(f"  read it: {name} => {outcome}")
            continue
        if not ok and "…" in exp:
            by_eye += 1
            print(f"  read it (prose expectation): {name}\n    got:    {outcome}\n    expect: {exp}")
        elif not ok:
            bad += 1
            print(f"  MISMATCH: {name}\n    got:    {outcome}\n    expect: {exp}")
    checked = len(rows) - unchecked - by_eye
    print(f"  {checked - bad}/{checked} as expected" + (f", {bad} MISMATCHED" if bad else "")
          + (f"; {unchecked + by_eye} to read (no machine-checkable expectation)" if unchecked + by_eye else ""))
    return 1 if bad or not rows else 0


if __name__ == "__main__":
    sys.exit(main())
