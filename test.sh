#!/bin/bash

# Get the current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)

# Check if we're already on master
if [ "$current_branch" == "master" ]; then
  echo "Already on master. Nothing to do."
  exit 0
fi

# Switch to master
git checkout master

# Merge the current branch into master, favoring the current branch in conflicts
git merge "$current_branch" -X theirs

# Check if there were conflicts
if [ $? -ne 0 ]; then
  echo "Conflicts detected. Resolving in favor of '$current_branch'..."

  # Add all resolved files
  git add .

  # Commit the merge
  git commit -m "Merge $current_branch into master, resolving conflicts in favor of $current_branch"

  echo "Merge completed with conflicts resolved."
else
  echo "Merge completed without conflicts."
fi

# Switch back to the original branch (optional)
git checkout "$current_branch"

echo "Finished."