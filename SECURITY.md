# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.2.x | Yes |
| < 1.2 | No |

## Reporting a vulnerability

Report vulnerabilities privately through **Security > Report a vulnerability** in this repository. If private reporting is unavailable, contact the maintainer through their GitHub profile. Include the affected app version, impact, and steps to reproduce. Avoid posting exploit details publicly before a fix is available.

## Data access review

The PocketBase collection exports in this repository use owner-scoped rules for
private `routes`, group-member checks for `live_locations`, and public reads only
for published community routes and their community interactions. The
`mtb_groups`, `mtb_group_members`, `mtb_group_rankings`, and
`mtb_group_ranking_entries` collections have locked rules (`null`); clients must
use the authenticated `/api/mtb/groups/*` hooks, which perform membership and
administrator checks.

Deleting a user cascades to their community routes and dependent public
interactions through `community_routes.owner`.

Community route tracks are public data. The PocketBase request hook trims 150 m
from both ends before storing a track and rejects POIs within 150 m of the
submitted endpoints. This reduces location exposure but does not guarantee
anonymity. The client also resizes and re-encodes photos; server-side EXIF
stripping is not configured by these collection exports, so uploaded image
metadata is not guaranteed to be sanitized by PocketBase.

The API bearer token supports persistent sign-in and is stored in browser
`localStorage`. JavaScript running in the app origin can access it, so script
injection or a compromised third-party script could expose the session. API
requests now bypass browser caches and reject redirects to avoid persisting
private API responses or following unexpected redirects. These measures do not
protect against same-origin script execution. A stronger design needs a
short-lived token behind a server-side session, or platform secure storage for
the native app.

The collection exports do not include the PocketBase `users` auth collection
configuration or the live production database rules. Verify those separately:
profile fields such as email, age, weight, avatar, and `groupCode` must not be
publicly listable, and only the authenticated owner should be able to update
their profile. Also verify HTTPS, admin credentials, backups, and PocketBase
version on the deployed server.
