import { matchServiceToMedicare } from './medicareMatcher.js';
import { matchServiceToLab } from './labMatcher.js';
import { matchServiceToDrug } from './drugMatcher.js';
import { matchServiceToCPT } from './cptMatcher.js';
import { matchServiceToOPPS } from './oppsMatcher.js';

/**
 * Factory function to get the appropriate matcher for a database
 * @param {string} database - The database to match against
 * @returns {Function} - The matcher function for the database
 */
export function getDatabaseMatcher(database) {
  console.log(`[DATABASE_MATCHER_FACTORY] Getting matcher for database: ${database}`);
  
  switch (database) {
    case 'PFS':
      console.log('[DATABASE_MATCHER_FACTORY] Using Medicare PFS matcher');
      return matchServiceToMedicare;
      
    case 'CLFS':
      console.log('[DATABASE_MATCHER_FACTORY] Using Lab Fee Schedule matcher');
      return matchServiceToLab;
      
    case 'ASP':
      console.log('[DATABASE_MATCHER_FACTORY] Using Drug ASP matcher');
      return matchServiceToDrug;
      
    case 'DME':
      console.log('[DATABASE_MATCHER_FACTORY] Using DME Fee Schedule matcher');
      return matchServiceToCPT;
      
    case 'OPPS':
      console.log('[DATABASE_MATCHER_FACTORY] Using OPPS matcher');
      return matchServiceToOPPS;
      
    default:
      // Default to CPT matcher as a fallback
      console.log(`[DATABASE_MATCHER_FACTORY] No specific matcher for ${database}, using CPT matcher as fallback`);
      return matchServiceToCPT;
  }
} 