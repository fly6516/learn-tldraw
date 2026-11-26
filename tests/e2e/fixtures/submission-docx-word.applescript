on run argv
  set inputPath to item 1 of argv
  set manuscript to POSIX file inputPath
  set expectedName to do shell script "/usr/bin/basename " & quoted form of inputPath
  set expectedHeading to "实验设计"
  if (count of argv) > 1 then set expectedHeading to item 2 of argv
  with timeout of 75 seconds
    tell application id "com.microsoft.Word"
      open manuscript add to recent files false repair false
      set submission to document expectedName
      if read only of submission then error "Test DOCX is read-only."
      if (count of tables of contents of submission) is not 1 then error "Expected one native TOC."
      set contentsTable to first table of contents of submission
      update contentsTable
      repaginate submission
      repeat with prefix in {"SEQ ", "REF ", "PAGEREF "}
        repeat with fieldIndex from 1 to (count of fields of submission)
          set entry to field fieldIndex of submission
          set instruction to content of field code of entry
          if instruction starts with (contents of prefix) or instruction starts with (" " & (contents of prefix)) then
            if (update field entry) is false then error "Could not update " & instruction
            set updatedResult to content of result range of entry
            if updatedResult is missing value or updatedResult contains "错误!" or updatedResult contains "Error!" then error "Field result is invalid for " & instruction
          end if
        end repeat
      end repeat
      repaginate submission
      update page numbers contentsTable
      save submission
      close submission saving no
      open manuscript read only true add to recent files false repair false
      set submission to document expectedName
      set contentsTable to first table of contents of submission
      set tocText to content of text object of contentsTable
      if tocText contains "—" or tocText does not contain expectedHeading or tocText does not contain "参考文献" or tocText contains "Error!" or tocText contains "错误!" then error "Saved TOC incomplete."
      if (upper heading level of contentsTable is not 1) or (lower heading level of contentsTable is not 3) then error "Invalid TOC depth."
      set tableProof to ""
      repeat with tableIndex from 1 to (count of tables of submission)
        set candidate to table tableIndex of submission
        if (count of rows of candidate) > 50 then
          set titleRow to first row of candidate
          set headerRow to second row of candidate
          set finalRow to last row of candidate
          if not (heading format of titleRow) or not (heading format of headerRow) then error "Long table title or header does not repeat."
          if allow break across pages of finalRow then error "The table row can split across pages."
          set firstPage to (get range information (text object of titleRow) information type active end page number) as integer
          set lastPage to (get range information (text object of finalRow) information type active end page number) as integer
          if lastPage is less than or equal to firstPage then error "Long table did not span multiple pages."
          set tableProof to "Long table pages " & firstPage & "–" & lastPage & ", rows " & (count of rows of candidate) & "." & linefeed
        end if
      end repeat
      set wordVersion to version
      close submission saving no
      return "Saved and reopened in Microsoft Word " & wordVersion & " with TOC 1–3." & linefeed & tableProof & tocText
    end tell
  end timeout
end run
