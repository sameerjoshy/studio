import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const ACTIVE = new Set(['queued', 'dispatched', 'running']);

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const refresh = useCallback(async () => {
    try {
      const { jobs: list } = await api.jobs();
      setJobs((previous) => {
        const detail = new Map(previous.map((job) => [job.id, job]));
        return list.map((job) => ({ ...(detail.get(job.id) ?? {}), ...job }));
      });
    } catch {
      /* signed out or offline */
    }
  }, []);

  const addJob = useCallback((job) => {
    setJobs((previous) => {
      if (previous.some((item) => item.id === job.id)) return previous;
      return [{ ...job, events: [], url: null }, ...previous];
    });
  }, []);

  const fetchDetail = useCallback(async (id) => {
    try {
      const detail = await api.job(id);
      setJobs((previous) =>
        previous.map((job) =>
          job.id === id ? { ...job, ...detail.job, events: detail.events, url: detail.url } : job,
        ),
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      const active = jobsRef.current.filter((job) => ACTIVE.has(job.status));
      if (!active.length) return;

      await Promise.all(
        active.map(async (job) => {
          try {
            const detail = await api.job(job.id);
            setJobs((previous) =>
              previous.map((item) =>
                item.id === job.id
                  ? { ...item, ...detail.job, events: detail.events, url: detail.url }
                  : item,
              ),
            );
          } catch {
            /* ignore a single failed poll */
          }
        }),
      );
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  return { jobs, addJob, refresh, fetchDetail };
}
