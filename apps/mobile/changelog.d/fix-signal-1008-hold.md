### Fixed

- A remote connection that Signal refuses for a reason other than a rate limit, such as an invalid ticket, reconnects at once. Before, OpenBot waited 60 seconds as if Signal had limited its rate.
